const WebSocket = require('ws');
const { spawn } = require('child_process');

const PORT = 8888;

console.log(`RTSP 转 WebSocket 服务器启动在端口 ${PORT}`);

const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws) => {
    console.log('客户端已连接');
    
    let ffmpeg = null;
    
    ws.on('message', (message) => {
        console.log('收到消息:', message);
    });
    
    ws.on('close', () => {
        console.log('客户端断开连接');
        if (ffmpeg) {
            ffmpeg.kill();
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket 错误:', error);
        if (ffmpeg) {
            ffmpeg.kill();
        }
    });
});

wss.on('error', (error) => {
    console.error('WebSocket 服务器错误:', error);
});

console.log('\n使用方法:');
console.log('1. 在 Electron 播放器中输入：ws://localhost:8888/');
console.log('2. 使用 FFmpeg 推送流到服务器');
console.log('\nFFmpeg 命令示例:');
console.log('ffmpeg -re -i input.mp4 -c copy -f flv rtmp://localhost:1935/live/stream');
console.log('\n或使用 RTSP 源:');
console.log('ffmpeg -i rtsp://camera-ip/stream -c:v libx264 -preset ultrafast -tune zerolatency -c:a aac -f flv rtmp://localhost:1935/live/stream');
