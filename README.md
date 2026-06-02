# Electron 视频播放器 - 使用指南

## 支持的格式

### ✅ 直接支持
- **MP4** - 本地文件或 HTTP 链接
- **FLV** - 使用 mpegts.js 播放（支持 H.264/H.265）
- **M3U8/HLS** - 使用 hls.js 播放
- **WebSocket 流** - ws:// 或 wss:// 协议的实时视频流

### ⚠️ RTSP/RTMP 需要转换

浏览器和 Electron **不直接支持 RTSP/RTMP**，需要先转换为以下格式之一：

#### 方案 1: FFmpeg 转 HLS
```bash
ffmpeg -i rtsp://camera-ip/stream -c:v libx264 -c:a aac -f hls http://localhost:8080/stream.m3u8
```

#### 方案 2: FFmpeg 转 FLV
```bash
ffmpeg -i rtsp://camera-ip/stream -c:v libx264 -c:a aac -f flv http://localhost:8080/stream.flv
```

#### 方案 3: node-rtsp-stream 转 WebSocket
```bash
# 安装依赖
npm install node-rtsp-stream

# 运行转换服务器
node rtsp-server.js
```

## 启动播放器

```bash
npm start
```

## 使用方法

1. **播放本地文件**：菜单 → 文件 → 打开文件
2. **播放网络视频**：菜单 → 文件 → 打开网络地址
3. **播放 RTSP 流**：先转换为 HLS/FLV/WebSocket，然后输入转换后的地址

## mpegts.js vs flv.js

### mpegts.js 优势
- ✅ 支持 H.265/HEVC 编码
- ✅ 支持 MSE 媒体源扩展
- ✅ 更好的性能
- ✅ 支持直播流

### flv.js 限制
- ❌ 仅支持 H.264 编码
- ❌ 不支持 H.265

## WebSocket 流格式

WebSocket 传输的视频数据应为：
- MP4 fragmented segments
- WebM 格式
- 或其他浏览器支持的媒体格式

示例代码（服务端）：
```javascript
const ws = new WebSocket('ws://server/stream');
ws.binaryType = 'arraybuffer';

ws.onmessage = (event) => {
    const data = event.data; // ArrayBuffer
    sourceBuffer.appendBuffer(data);
};
```

## 常见问题

### Q: 为什么 RTSP 不能直接播放？
A: RTSP 是专用协议，需要 RTP/RTCP 传输，浏览器不支持。必须通过服务器转换。

### Q: H.265 视频无法播放？
A: 确保使用 mpegts.js（已集成），并且浏览器支持 H.265 解码。

### Q: 播放卡顿怎么办？
A: 
- 检查网络连接
- 降低视频码率
- 使用更低的分辨率
- 确保使用合适的编解码器

因为非原生的视频监控播放器，界面友好清晰，安装后包会比较大，约500MB
