const path = require('path');
const { spawn } = require('child_process');

const DEADLOCK_MS = 10 * 60 * 1000;

function startPythonDownload({ mainWindow, url, outputDir, bitrate, extraArgs = [] }) {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(__dirname, '..', '..', '..', 'backend', 'download.py');

    const processArgs = [
      scriptPath,
      '--url',
      url,
      '--output',
      outputDir,
      '--bitrate',
      bitrate || '192k',
      ...extraArgs,
    ];

    const child = spawn(pythonCmd, processArgs, { cwd: path.join(__dirname, '..') });

    let lastData = null;
    let stdoutBuffer = '';
    let lastProgressAt = Date.now();
    let deadlockTimer = null;

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        try {
          const payload = JSON.parse(line);

          if (payload.type === 'progress') {
            const allowed = new Set(['download', 'convert', 'completed']);
            if (allowed.has(payload.status)) {
              lastProgressAt = Date.now();
              if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send('conversion-progress', payload);
              }
            } else if (payload.status === 'error') {
              console.warn('Backend reported non-fatal progress error:', payload.message || payload);
            }
          } else if (payload.type === 'result') {
            lastData = payload;
            lastProgressAt = Date.now();
          } else if (payload.type === 'error') {
            console.error('Backend fatal error:', payload.message || payload);
            lastProgressAt = Date.now();
          }
        } catch {
          console.warn('Non-JSON stdout:', line);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const message = chunk.toString();
      console.warn('Python stderr:', message.trim());
    });

    deadlockTimer = setInterval(() => {
      if (Date.now() - lastProgressAt > DEADLOCK_MS) {
        console.error('Conversion appears to be stalled (no progress for >10min).');
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('conversion-progress', {
            status: 'error',
            progress: 100,
            message: '변환이 장시간 멈췄습니다. 자세한 내용은 변환 로그(conversion.log)를 확인하세요.',
            log_path: null,
            fatal: true,
          });
        }

        try {
          child.kill();
        } catch (e) {
          console.warn('Failed to kill stalled child process', e);
        }

        clearInterval(deadlockTimer);
        const e = new Error('Conversion stalled (deadlock)');
        e.fatal = true;
        reject(e);
      }
    }, 30 * 1000);

    child.on('close', (code) => {
      if (deadlockTimer) {
        clearInterval(deadlockTimer);
        deadlockTimer = null;
      }

      if (stdoutBuffer.trim()) {
        try {
          const payload = JSON.parse(stdoutBuffer.trim());
          if (payload.type === 'result') {
            lastData = payload;
          }
        } catch {
          // ignore trailing non-json fragments
        }
      }

      if (code === 0 && lastData) {
        resolve(lastData);
      } else if (code === 0 && !lastData) {
        const e = new Error('변환이 완료되었지만 결과를 가져올 수 없습니다.');
        e.fatal = true;
        reject(e);
      } else {
        const e = new Error(`Python 변환 프로세스가 종료되었습니다 (code=${code})`);
        e.fatal = true;
        reject(e);
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

module.exports = {
  startPythonDownload,
};
