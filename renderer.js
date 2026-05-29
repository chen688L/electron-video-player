const { ipcRenderer } = require('electron');
const Hls = require('hls.js');
const mpegts = require('mpegts.js');

const video = document.getElementById('video');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const timeDisplay = document.getElementById('time-display');
const volumeBtn = document.getElementById('volume-btn');
const volumeSlider = document.getElementById('volume-slider');
const volumeFill = document.getElementById('volume-fill');
const speedControl = document.getElementById('speed-control');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const urlInputModal = document.getElementById('url-input-modal');
const overlay = document.getElementById('overlay');
const urlInput = document.getElementById('url-input');
const okBtn = document.getElementById('ok-btn');
const cancelBtn = document.getElementById('cancel-btn');
const helpModal = document.getElementById('help-modal');
const helpCloseBtn = document.getElementById('help-close-btn');
const emptyState = document.getElementById('empty-state');
const controls = document.getElementById('controls');
const loading = document.getElementById('loading');
const errorMessage = document.getElementById('error-message');
const debugLogs = document.getElementById('debug-logs');

let hls = null;
let fmp4Player = null;
let ws = null;
let rtspStreamId = null;

function addLog(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const logMessage = `[${time}] ${message}`;
    
    if (debugLogs) {
        const logDiv = document.createElement('div');
        logDiv.className = `debug-log ${type}`;
        logDiv.textContent = logMessage;
        debugLogs.appendChild(logDiv);
        debugLogs.scrollTop = debugLogs.scrollHeight;
    }
    
    console[type](logMessage);
}

function clearLogs() {
    if (debugLogs) {
        debugLogs.innerHTML = '';
    }
}


function showLoading() {
    loading.classList.add('active');
    errorMessage.classList.remove('active');
}

function hideLoading() {
    loading.classList.remove('active');
}

function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.add('active');
    hideLoading();
}

function hideError() {
    errorMessage.classList.remove('active');
}

function showEmptyState() {
    hasActiveSource = false;
    emptyState.classList.add('active');
    controls.classList.add('hidden');
    video.classList.add('hidden');
    hideLoading();
    hideError();
}

function showPlayerUI() {
    emptyState.classList.remove('active');
    controls.classList.remove('hidden');
    video.classList.remove('hidden');
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateProgress() {
    if (video.duration && isFinite(video.duration)) {
        const progress = (video.currentTime / video.duration) * 100;
        progressFill.style.width = `${progress}%`;
        timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    } else if (hasActiveSource) {
        progressFill.style.width = '0%';
        timeDisplay.textContent = '直播中';
    }
}

function updateVolume() {
    volumeFill.style.width = `${video.volume * 100}%`;
    volumeBtn.textContent = video.volume === 0 || video.muted ? '🔇' : '🔊';
}

function destroyPlayers() {
    if (hls) {
        hls.destroy();
        hls = null;
    }
    if (fmp4Player) {
        fmp4Player.destroy();
        fmp4Player = null;
    }
    if (ws) {
        ws.close();
        ws = null;
    }
    if (rtspStreamId) {
        ipcRenderer.invoke('stop-rtsp', rtspStreamId).catch(() => {});
        rtspStreamId = null;
    }
}

function loadVideo(url) {
    destroyPlayers();
    showPlayerUI();
    hasActiveSource = true;
    showLoading();
    hideError();

    video.src = '';
    video.load();

    const lowerUrl = url.toLowerCase();

    if (lowerUrl.startsWith('ws://') || lowerUrl.startsWith('wss://')) {
        loadWebSocket(url);
    } else if (lowerUrl.startsWith('rtsp://') || lowerUrl.startsWith('rtmp://')) {
        loadRTSP(url);
    } else if (lowerUrl.endsWith('.m3u8') || lowerUrl.includes('.m3u8?')) {
        loadHLS(url);
    } else if (lowerUrl.endsWith('.flv') || lowerUrl.includes('.flv?')) {
        loadMPEGTS(url);
    } else {
        loadNative(url);
    }
}

function loadHLS(url) {
    if (Hls.isSupported()) {
        hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            hideLoading();
            video.play().catch(e => console.log(e));
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS Error:', data);
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        showError('网络错误，请检查网络连接');
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        showError('媒体解码错误');
                        break;
                    default:
                        showError('无法播放 HLS 视频');
                        break;
                }
            }
        });

        hls.loadSource(url);
        hls.attachMedia(video);
    } else {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => {
                hideLoading();
                video.play().catch(e => console.log(e));
            });
        } else {
            showError('浏览器不支持 HLS 播放');
        }
    }
}

function inferStreamType(url) {
    const lower = url.toLowerCase();
    if (lower.includes('.flv') || lower.includes('/flv')) return 'flv';
    if (lower.includes('.ts') || lower.includes('.m2ts') || lower.includes('mpegts')) return 'mpegts';
    return 'flv';
}

function loadMPEGTS(url) {
    const features = mpegts.getFeatureList();
    if (!features.mseLivePlayback && !features.msePlayback) {
        showError('浏览器不支持 MPEGTS/FLV 播放');
        return;
    }

    const streamType = inferStreamType(url);
    fmp4Player = mpegts.createPlayer({
        type: streamType,
        url: url,
        isLive: url.includes('live') || url.includes('.m3u8'),
        enableStashBuffer: false
    });

    fmp4Player.on(mpegts.Events.MEDIA_INFO, () => {
        hideLoading();
        video.play().catch(e => console.log(e));
    });

    fmp4Player.on(mpegts.Events.ERROR, (err) => {
        console.error('MPEGTS Error:', err);
        showError('无法播放 FLV/MPEGTS 视频');
    });

    fmp4Player.attachMediaElement(video);
    fmp4Player.load();
}

async function loadRTSP(url) {
    addLog('正在通过 FFmpeg 转换 RTSP/RTMP: ' + url);

    try {
        const result = await ipcRenderer.invoke('play-rtsp', url);
        if (!result.success) {
            showError(result.error || 'RTSP 转换失败');
            return;
        }

        rtspStreamId = result.streamId;
        addLog('本地播放地址: ' + result.wsUrl);
        loadWebSocketFLV(result.wsUrl, { isLive: !result.isVod, timeoutMs: result.isVod ? 45000 : 30000 });
    } catch (error) {
        addLog('RTSP 启动异常: ' + error.message, 'error');
        showError('RTSP 启动失败: ' + error.message);
    }
}

function loadWebSocket(url) {
    const lowerUrl = url.toLowerCase();

    if (lowerUrl.includes('.flv') || lowerUrl.includes('/flv/') || lowerUrl.includes('/rtp/')) {
        loadWebSocketFLV(url);
    } else {
        loadWebSocketMP4(url);
    }
}

function loadWebSocketFLV(url, options = {}) {
    const { isLive = true, timeoutMs = 15000 } = options;
    addLog('直接连接 WebSocket FLV: ' + url);

    const featureList = mpegts.getFeatureList();
    if (!featureList.mseLivePlayback && !featureList.msePlayback) {
        showError('浏览器不支持 FLV 直播播放');
        return;
    }

    let loadTimeout = null;

    try {
        fmp4Player = mpegts.createPlayer({
            type: inferStreamType(url),
            url: url,
            isLive: isLive,
            enableStashBuffer: true,
            stashInitialSize: 256,
            autoCleanupSourceBuffer: true,
            autoCleanupMaxBackwardDuration: 3,
            autoCleanupMinBackwardDuration: 2,
            enableWorker: true,
            liveBufferLatency: 1,
            liveBufferLatencyMinRemain: 0.5
        });

        fmp4Player.on(mpegts.Events.MEDIA_INFO, () => {
            addLog('流信息已解析，开始播放');
            if (loadTimeout) clearTimeout(loadTimeout);
            hideLoading();
            video.play().catch(e => {
                addLog('播放失败: ' + e.message, 'error');
                showError('播放失败: ' + e.message);
            });
        });

        fmp4Player.on(mpegts.Events.ERROR, (err) => {
            addLog('FLV 播放器错误: ' + (err.message || JSON.stringify(err)), 'error');
            showError('FLV 播放错误: ' + (err.message || '未知错误'));
        });

        fmp4Player.attachMediaElement(video);
        fmp4Player.load();

        loadTimeout = setTimeout(() => {
            if (loading.classList.contains('active')) {
                addLog(`WebSocket FLV 连接超时 (${timeoutMs / 1000}秒)`, 'error');
                showError('连接超时，请检查地址或网络（RTSP 国外演示源可能无法访问）');
            }
        }, timeoutMs);
    } catch (e) {
        addLog('创建播放器失败: ' + e.message, 'error');
        showError('播放器创建失败: ' + e.message);
    }
}

function loadWebSocketMP4(url) {
    addLog('尝试播放 WebSocket MP4 流: ' + url);
    
    const mediaSource = new MediaSource();
    video.src = URL.createObjectURL(mediaSource);

    let sourceBuffer = null;
    let isFirstChunk = true;

    mediaSource.addEventListener('sourceopen', () => {
        addLog('MediaSource 已打开');
        try {
            if (MediaSource.isTypeSupported('video/mp4; codecs="avc1.4D401E, mp4a.40.2"')) {
                sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.4D401E, mp4a.40.2"');
                addLog('创建 MP4 SourceBuffer 成功');
            } else if (MediaSource.isTypeSupported('video/webm; codecs="vp8, vorbis"')) {
                sourceBuffer = mediaSource.addSourceBuffer('video/webm; codecs="vp8, vorbis"');
                addLog('创建 WebM SourceBuffer 成功');
            } else {
                showError('不支持的媒体格式');
                addLog('不支持的媒体格式', 'error');
                return;
            }
            
            sourceBuffer.mode = 'sequence';

            ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                addLog('WebSocket 已连接');
            };

            ws.onmessage = (event) => {
                if (event.data instanceof ArrayBuffer) {
                    addLog('收到数据: ' + event.data.byteLength + ' bytes');
                    if (sourceBuffer && !sourceBuffer.updating) {
                        try {
                            sourceBuffer.appendBuffer(event.data);
                            if (isFirstChunk) {
                                isFirstChunk = false;
                                hideLoading();
                                video.play().catch(e => {
                                    addLog('播放失败: ' + e.message, 'error');
                                });
                            }
                        } catch (e) {
                            addLog('数据写入错误: ' + e.message, 'error');
                        }
                    } else {
                        addLog('SourceBuffer 正在更新，跳过数据', 'warn');
                    }
                } else {
                    addLog('收到非二进制数据: ' + typeof event.data, 'warn');
                }
            };

            ws.onerror = (error) => {
                addLog('WebSocket 错误: ' + (error.message || JSON.stringify(error)), 'error');
                showError('WebSocket 连接失败');
            };

            ws.onclose = (event) => {
                addLog('WebSocket 关闭: code=' + event.code + ', reason=' + event.reason);
            };
        } catch (e) {
            addLog('MediaSource 初始化失败: ' + e.message, 'error');
            showError('MediaSource 初始化失败：' + e.message);
        }
    });

    mediaSource.addEventListener('error', (e) => {
        addLog('MediaSource 错误: ' + (e.message || JSON.stringify(e)), 'error');
        showError('媒体源错误');
    });
    
    setTimeout(() => {
        if (loading.classList.contains('active')) {
            addLog('WebSocket MP4 流连接超时 (10秒)', 'error');
            showError('连接超时，请检查网络或服务器状态');
        }
    }, 10000);
}

function loadNative(url) {
    video.src = url;
    video.addEventListener('loadedmetadata', () => {
        hideLoading();
        video.play().catch(e => console.log(e));
    });

    video.addEventListener('error', () => {
        showError('无法播放该视频文件');
    });
}

playBtn.addEventListener('click', () => {
    video.play().then(() => {
        playBtn.style.display = 'none';
        pauseBtn.style.display = 'block';
    }).catch(e => console.log(e));
});

pauseBtn.addEventListener('click', () => {
    video.pause();
    pauseBtn.style.display = 'none';
    playBtn.style.display = 'block';
});

video.addEventListener('play', () => {
    playBtn.style.display = 'none';
    pauseBtn.style.display = 'block';
});

video.addEventListener('pause', () => {
    pauseBtn.style.display = 'none';
    playBtn.style.display = 'block';
});

video.addEventListener('timeupdate', updateProgress);

video.addEventListener('loadedmetadata', () => {
    updateProgress();
    updateVolume();
});

progressBar.addEventListener('click', (e) => {
    if (!video.duration || !isFinite(video.duration)) return;
    const rect = progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    video.currentTime = percent * video.duration;
});

volumeBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    updateVolume();
});

volumeSlider.addEventListener('click', (e) => {
    const rect = volumeSlider.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    video.volume = Math.max(0, Math.min(1, percent));
    video.muted = false;
    updateVolume();
});

speedControl.addEventListener('change', () => {
    video.playbackRate = parseFloat(speedControl.value);
});

function updateFullscreenBtn(isFullscreen) {
    fullscreenBtn.textContent = isFullscreen ? '🗗' : '⛶';
    fullscreenBtn.title = isFullscreen ? '退出全屏 (Esc)' : '全屏';
}

fullscreenBtn.addEventListener('click', () => {
    ipcRenderer.send('toggle-fullscreen');
});

ipcRenderer.on('fullscreen-changed', (event, isFullscreen) => {
    updateFullscreenBtn(isFullscreen);
});

function closeModals() {
    urlInputModal.classList.remove('active');
    helpModal.classList.remove('active');
    overlay.classList.remove('active');
    urlInput.value = '';
}

function showHelp() {
    urlInputModal.classList.remove('active');
    urlInput.value = '';
    helpModal.classList.add('active');
    overlay.classList.add('active');
}

cancelBtn.addEventListener('click', closeModals);

helpCloseBtn.addEventListener('click', closeModals);

overlay.addEventListener('click', closeModals);

okBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (url) {
        loadVideo(url);
        ipcRenderer.send('set-title', `Electron Video Player - ${url}`);
        closeModals();
    }
});

ipcRenderer.on('open-file', (event, filePath) => {
    loadVideo(`file://${filePath}`);
    ipcRenderer.send('set-title', `Electron Video Player - ${filePath}`);
});

ipcRenderer.on('open-url', () => {
    helpModal.classList.remove('active');
    urlInputModal.classList.add('active');
    overlay.classList.add('active');
    urlInput.focus();
});

ipcRenderer.on('show-help', showHelp);

ipcRenderer.on('rtsp-stream-error', (event, { streamId, message }) => {
    if (streamId !== rtspStreamId) return;
    addLog('RTSP 拉流错误: ' + message, 'error');
    showError(message);
});

urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        okBtn.click();
    }
});

let hasActiveSource = false;

video.addEventListener('waiting', () => {
    if (hasActiveSource) showLoading();
});

video.addEventListener('canplay', hideLoading);

showEmptyState();
