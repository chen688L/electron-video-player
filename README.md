# Electron 视频播放器 - 使用指南

## 支持的格式

### ✅ 直接支持
- **MP4** - 本地文件或 HTTP 链接
- **FLV** - 使用 mpegts.js 播放（支持 H.264/H.265）
- **M3U8/HLS** - 使用 hls.js 播放
- **WebSocket 流** - ws:// 或 wss:// 协议的实时视频流

### ✅ RTSP / RTMP（内置 FFmpeg）

直接输入 `rtsp://` 或 `rtmp://` 地址即可，程序内置 FFmpeg 自动转 FLV 播放（打包时已包含，用户无需安装）。

## 启动播放器

```bash
npm start
```

## 使用方法

1. **播放本地文件**：菜单 → 文件 → 打开文件
2. **播放网络视频**：菜单 → 文件 → 打开网络地址
3. **播放 RTSP/RTMP**：直接输入 `rtsp://` 或 `rtmp://` 地址

## 打包体积说明

安装包约 **450MB** 左右，主要来自：
- **Electron（Chromium）**：约 300MB，所有 Electron 应用均如此
- **FFmpeg**：约 79MB，用于 RTSP/RTMP 转码（仅打包一份）

开发打包前执行 `npm install`（会下载 FFmpeg 到 `node_modules`，仅用于打进安装包）。

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

分发安装包：将 `dist/Electron Video Player Setup x.x.x.exe` 发给用户即可，无需 Node.js。
