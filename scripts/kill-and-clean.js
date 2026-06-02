const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

function run(cmd) {
    try {
        execSync(cmd, { stdio: 'ignore' });
    } catch {
        // ignore
    }
}

function killLockingProcesses() {
    if (process.platform === 'win32') {
        run('taskkill /F /IM "Electron Video Player.exe" /T');
        run('taskkill /F /IM electron.exe /T');
    } else {
        run('pkill -f "Electron Video Player"');
        run('pkill -f electron');
    }
}

function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {}
}

function removeDist(retries = 5) {
    if (!fs.existsSync(distDir)) {
        return true;
    }

    for (let i = 0; i < retries; i++) {
        try {
            fs.rmSync(distDir, { recursive: true, force: true });
            return true;
        } catch (err) {
            if (i < retries - 1) {
                sleep(500 * (i + 1));
            } else {
                console.error('\n无法删除 dist 目录，文件被占用：');
                console.error(distDir);
                console.error('\n请先手动处理后再打包：');
                console.error('1. 关闭正在运行的「Electron Video Player」');
                console.error('2. 关闭 npm start 启动的开发窗口');
                console.error('3. 关闭资源管理器中打开的 dist 文件夹');
                console.error('4. 在任务管理器中结束 electron.exe 相关进程');
                console.error('5. 再执行: npm run dist:win\n');
                console.error(err.message);
                process.exit(1);
            }
        }
    }
    return false;
}

killLockingProcesses();
removeDist();
