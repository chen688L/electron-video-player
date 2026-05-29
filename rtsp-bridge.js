const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

let electronApp = null;
try {
    electronApp = require('electron').app;
} catch {
    // 非 Electron 环境（如单独测试脚本）
}

let server = null;
let port = 8890;
const sessions = new Map();
let ffmpegPath = null;
let notifyRenderer = null;

function setNotifier(fn) {
    notifyRenderer = fn;
}

function emitError(streamId, message) {
    console.error('[rtsp-bridge]', streamId, message);
    if (notifyRenderer) {
        notifyRenderer(streamId, message);
    }
}

function isPackagedApp() {
    return Boolean(electronApp && electronApp.isPackaged);
}

function getPackagedFfmpegPath() {
    if (!process.resourcesPath) {
        return null;
    }
    const names = process.platform === 'win32' ? ['ffmpeg.exe'] : ['ffmpeg'];
    for (const name of names) {
        const candidate = path.join(process.resourcesPath, 'ffmpeg', name);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function resolveFfmpegPath() {
    if (ffmpegPath) {
        return ffmpegPath;
    }

    const candidates = [];

    // 打包后的安装目录（electron-builder extraResources）
    const packaged = getPackagedFfmpegPath();
    if (packaged) {
        candidates.push(packaged);
    }

    // 开发环境：npm install 时下载到 node_modules/ffmpeg-static
    try {
        const bundled = require('ffmpeg-static');
        if (bundled) {
            candidates.push(bundled);
        }
    } catch {
        // ffmpeg-static 未安装时忽略
    }

    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            ffmpegPath = candidate;
            return ffmpegPath;
        }
    }

    // 兜底：系统 PATH 中的 ffmpeg（可选）
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        ffmpegPath = 'ffmpeg';
        return ffmpegPath;
    } catch {
        return null;
    }
}

function isFfmpegAvailable() {
    return resolveFfmpegPath() !== null;
}

function isVodUrl(inputUrl) {
    const lower = inputUrl.toLowerCase();
    return lower.includes('/vod/') || lower.includes('vod/');
}

function buildFfmpegArgs(inputUrl, options = {}) {
    const lower = inputUrl.toLowerCase();
    const isRtsp = lower.startsWith('rtsp://');
    const isVod = isVodUrl(inputUrl);
    const transport = options.transport || 'tcp';
    const useTranscode = options.transcode === true;

    const args = [
        '-hide_banner',
        '-loglevel', 'warning'
    ];

    if (isRtsp) {
        args.push(
            '-rtsp_transport', transport,
            '-stimeout', '15000000',
            '-rw_timeout', '15000000'
        );
    }

    if (!isVod) {
        args.push('-fflags', 'nobuffer', '-flags', 'low_delay');
    }

    args.push('-i', inputUrl);

    if (useTranscode) {
        args.push(
            '-c:v', 'libx264',
            '-preset', isVod ? 'veryfast' : 'ultrafast',
            '-tune', isVod ? 'film' : 'zerolatency',
            '-g', '30',
            '-c:a', 'aac',
            '-ar', '44100',
            '-b:a', '128k'
        );
    } else {
        args.push(
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-ar', '44100',
            '-ac', '2'
        );
    }

    args.push('-f', 'flv', 'pipe:1');
    return args;
}

function stopFfmpeg(session) {
    if (session.ffmpeg) {
        session.ffmpeg.removeAllListeners();
        session.ffmpeg.kill('SIGKILL');
        session.ffmpeg = null;
    }
}

function parseFfmpegError(stderrText) {
    const lines = stderrText.trim().split('\n').filter(Boolean);
    const last = lines.slice(-5).join('\n');
    if (/Connection refused|Connection timed out|No route to host/i.test(last)) {
        return '无法连接 RTSP 服务器，请检查地址、端口与网络（国外演示源在国内可能无法访问）';
    }
    if (/401|403|Unauthorized|Forbidden/i.test(last)) {
        return 'RTSP 鉴权失败，请检查用户名和密码';
    }
    if (/404|Not Found|method OPTIONS failed/i.test(last)) {
        return 'RTSP 流不存在或路径错误';
    }
    if (/Invalid data found|Could not find codec|Unsupported codec/i.test(last)) {
        return 'RTSP 流编码不支持，正在尝试转码…';
    }
    return last || 'FFmpeg 拉流失败';
}

function startFfmpeg(session, options = {}) {
    stopFfmpeg(session);

    const ffmpegBin = resolveFfmpegPath();
    const args = buildFfmpegArgs(session.inputUrl, options);
    console.log('[ffmpeg] spawn:', args.join(' '));

    let stderrBuf = '';
    const ffmpeg = spawn(ffmpegBin, args, { windowsHide: true });
    session.ffmpeg = ffmpeg;
    session.ffmpegOptions = options;

    ffmpeg.stdout.on('data', (chunk) => {
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(chunk);
        }
    });

    ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        stderrBuf += msg;
        const line = msg.trim();
        if (line) {
            console.log('[ffmpeg]', line);
        }
    });

    ffmpeg.on('close', (code) => {
        console.log('[ffmpeg] exited:', code, 'transport:', options.transport, 'transcode:', options.transcode);
        session.ffmpeg = null;

        if (code !== 0 && code !== null && !session.stopped) {
            const errMsg = parseFfmpegError(stderrBuf);

            if (session.inputUrl.toLowerCase().startsWith('rtsp://') && options.transport === 'tcp' && !session.triedUdp) {
                session.triedUdp = true;
                console.log('[ffmpeg] retry with UDP transport');
                startFfmpeg(session, { transport: 'udp', transcode: options.transcode });
                return;
            }

            if (!options.transcode) {
                console.log('[ffmpeg] retry with transcode');
                startFfmpeg(session, { transport: options.transport || 'tcp', transcode: true });
                return;
            }

            emitError(session.streamId, errMsg);
        }

        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
            session.ws.close();
        }
    });

    ffmpeg.on('error', (err) => {
        emitError(session.streamId, 'FFmpeg 启动失败: ' + err.message);
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
            session.ws.close(1011, err.message);
        }
    });
}

function onClientConnection(ws, req) {
    const streamId = (req.url || '').replace(/^\//, '');
    const session = sessions.get(streamId);

    if (!session) {
        ws.close(1008, 'Unknown stream');
        return;
    }

    if (session.ws) {
        ws.close(1008, 'Stream already connected');
        return;
    }

    session.ws = ws;
    session.stopped = false;
    console.log('RTSP bridge client connected:', streamId);
    startFfmpeg(session, { transport: 'tcp', transcode: false });

    ws.on('close', () => {
        console.log('RTSP bridge client disconnected:', streamId);
        session.ws = null;
        stopFfmpeg(session);
    });

    ws.on('error', (err) => {
        console.error('RTSP bridge ws error:', err);
        stopFfmpeg(session);
    });
}

function ensureServer() {
    return new Promise((resolve, reject) => {
        if (server) {
            resolve(port);
            return;
        }

        const wss = new WebSocket.Server({ port });
        server = wss;

        wss.on('connection', onClientConnection);

        wss.on('listening', () => {
            console.log('RTSP bridge listening on port', port);
            resolve(port);
        });

        wss.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                port++;
                server = null;
                ensureServer().then(resolve).catch(reject);
            } else {
                reject(err);
            }
        });
    });
}

async function createSession(inputUrl) {
    const ffmpegBin = resolveFfmpegPath();
    if (!ffmpegBin) {
        if (isPackagedApp()) {
            throw new Error('播放器内置 FFmpeg 缺失，请重新安装本程序或联系开发者。');
        }
        throw new Error(
            '未找到内置 FFmpeg。开发打包前请在项目目录执行:\n' +
            '  npm install\n' +
            '然后执行 npm run dist 生成安装包。'
        );
    }

    const listenPort = await ensureServer();
    const streamId = `rtsp_${Date.now()}`;
    sessions.set(streamId, {
        streamId,
        inputUrl,
        ffmpeg: null,
        ws: null,
        stopped: false,
        triedUdp: false
    });

    return {
        streamId,
        wsUrl: `ws://127.0.0.1:${listenPort}/${streamId}`,
        isVod: isVodUrl(inputUrl)
    };
}

function stopSession(streamId) {
    const session = sessions.get(streamId);
    if (!session) {
        return;
    }

    session.stopped = true;
    stopFfmpeg(session);
    if (session.ws) {
        session.ws.close();
    }
    sessions.delete(streamId);
    console.log('RTSP bridge session stopped:', streamId);
}

function shutdown() {
    for (const streamId of [...sessions.keys()]) {
        stopSession(streamId);
    }
    if (server) {
        server.close();
        server = null;
    }
}

module.exports = {
    createSession,
    stopSession,
    shutdown,
    isFfmpegAvailable,
    setNotifier
};
