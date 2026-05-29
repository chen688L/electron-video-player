const { app, BrowserWindow, Menu, ipcMain, dialog, net } = require('electron');
const path = require('path');
const WebSocket = require('ws');
const rtspBridge = require('./rtsp-bridge');

rtspBridge.setNotifier((streamId, message) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rtsp-stream-error', { streamId, message });
    }
});

let mainWindow;
let localWsServer = null;
let clientConnections = new Map();
let serverPort = 9999;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        title: 'Electron Video Player'
    });

    mainWindow.loadFile('index.html');

    const menu = Menu.buildFromTemplate([
        {
            label: '文件',
            submenu: [
                {
                    label: '打开文件',
                    click: () => {
                        dialog.showOpenDialog(mainWindow, {
                            properties: ['openFile'],
                            filters: [
                                { name: '视频文件', extensions: ['mp4', 'flv', 'm3u8', 'webm', 'mov'] }
                            ]
                        }).then(result => {
                            if (!result.canceled && result.filePaths.length > 0) {
                                mainWindow.webContents.send('open-file', result.filePaths[0]);
                            }
                        });
                    }
                },
                {
                    label: '打开网络地址',
                    click: () => {
                        mainWindow.webContents.send('open-url');
                    }
                },
                { type: 'separator' },
                {
                    label: '退出',
                    click: () => app.quit()
                }
            ]
        },
        {
            label: '视图',
            submenu: [
                {
                    label: '全屏',
                    click: () => {
                        mainWindow.setFullScreen(!mainWindow.isFullScreen());
                    }
                },
                {
                    label: '开发者工具',
                    click: () => mainWindow.webContents.openDevTools()
                }
            ]
        },
        {
            label: '帮助',
            submenu: [
                {
                    label: '操作说明',
                    click: () => {
                        mainWindow.webContents.send('show-help');
                    }
                }
            ]
        }
    ]);

    Menu.setApplicationMenu(menu);

    mainWindow.on('enter-full-screen', () => {
        mainWindow.webContents.send('fullscreen-changed', true);
    });
    mainWindow.on('leave-full-screen', () => {
        mainWindow.webContents.send('fullscreen-changed', false);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function startLocalWsServer() {
    return new Promise((resolve, reject) => {
        if (localWsServer) {
            resolve(serverPort);
            return;
        }

        localWsServer = new WebSocket.Server({ port: serverPort });

        localWsServer.on('connection', (ws, req) => {
            const clientId = req.url.substring(1);
            console.log('本地客户端连接:', clientId);
            clientConnections.set(clientId, ws);

            ws.on('message', (message) => {
                console.log('收到客户端消息:', message.length);
            });

            ws.on('close', () => {
                console.log('本地客户端断开');
                clientConnections.delete(clientId);
                const remoteWs = clientConnections.get('remote_' + clientId);
                if (remoteWs) {
                    remoteWs.close();
                    clientConnections.delete('remote_' + clientId);
                }
            });

            ws.on('error', (error) => {
                console.error('本地 WebSocket 错误:', error);
            });
        });

        localWsServer.on('error', (error) => {
            console.error('本地服务器错误:', error);
            if (error.code === 'EADDRINUSE') {
                serverPort++;
                localWsServer.close();
                localWsServer = null;
                resolve(startLocalWsServer());
            } else {
                reject(error);
            }
        });

        localWsServer.on('listening', () => {
            console.log('本地 WebSocket 服务器启动在端口:', serverPort);
            resolve(serverPort);
        });
    });
}

function connectToRemote(remoteUrl, clientId) {
    return new Promise((resolve, reject) => {
        console.log('连接远程 WebSocket:', remoteUrl);
        
        const isWss = remoteUrl.startsWith('wss://');
        const options = {};
        
        if (isWss) {
            options.rejectUnauthorized = false;
        }
        
        const remoteWs = new WebSocket(remoteUrl, options);

        remoteWs.on('open', () => {
            console.log('远程 WebSocket 已连接');
            clientConnections.set('remote_' + clientId, remoteWs);
            resolve();
        });

        remoteWs.on('message', (data) => {
            const localWs = clientConnections.get(clientId);
            if (localWs && localWs.readyState === WebSocket.OPEN) {
                localWs.send(data);
            }
        });

        remoteWs.on('close', () => {
            console.log('远程 WebSocket 断开');
            clientConnections.delete('remote_' + clientId);
            const localWs = clientConnections.get(clientId);
            if (localWs) {
                localWs.close();
            }
        });

        remoteWs.on('error', (error) => {
            console.error('远程 WebSocket 错误:', error);
            reject(error);
        });
    });
}

ipcMain.handle('connect-ws', async (event, url) => {
    try {
        const port = await startLocalWsServer();
        const clientId = 'player_' + Date.now();
        const localUrl = `ws://localhost:${port}/${clientId}`;
        
        await connectToRemote(url, clientId);
        
        return { success: true, localUrl, port };
    } catch (error) {
        console.error('连接失败:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.on('set-title', (event, title) => {
    mainWindow.setTitle(title);
});

ipcMain.on('toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        win.setFullScreen(!win.isFullScreen());
    }
});

ipcMain.handle('play-rtsp', async (event, inputUrl) => {
    try {
        const session = await rtspBridge.createSession(inputUrl);
        return { success: true, ...session };
    } catch (error) {
        console.error('RTSP bridge error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('stop-rtsp', (event, streamId) => {
    rtspBridge.stopSession(streamId);
    return { success: true };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (localWsServer) {
        localWsServer.close();
    }
    rtspBridge.shutdown();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
