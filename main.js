const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 760,
    minHeight: 600,
    title: 'Y2MP3 Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function startPythonConversion(url, outputDir, bitrate) {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(__dirname, 'backend', 'convert.py');
    outputDir = outputDir || path.join(__dirname, 'downloads');

  const processArgs = [scriptPath, '--url', url, '--output', outputDir, '--bitrate', bitrate || '192k'];
    const child = spawn(pythonCmd, processArgs, { cwd: __dirname });

  let lastData = null;
  let stdoutBuffer = '';
  let lastProgressAt = Date.now();
  const DEADLOCK_MS = 10 * 60 * 1000; // 10 minutes inactivity threshold
  let deadlockTimer = null;
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        try {
          const payload = JSON.parse(line);
          // Only forward meaningful progress stages to the UI.
          // Hide noisy 'info', 'warning', 'debug' messages and non-fatal error progress messages.
          if (payload.type === 'progress') {
            const allowed = new Set(['download', 'convert', 'completed']);
            if (allowed.has(payload.status)) {
              lastProgressAt = Date.now();
              if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send('conversion-progress', payload);
              }
            } else if (payload.status === 'error') {
              // Do NOT forward non-fatal 'error' progress messages to the UI.
              // Backend still logs details to conversion.log; keep a console warning for developers.
              console.warn('Backend reported non-fatal progress error:', payload.message || payload);
            } else {
              // drop info/debug/warning-type progress messages from UI; keep them in console for developers
              // (backend already writes them to conversion.log)
            }
          } else if (payload.type === 'result') {
            lastData = payload;
            lastProgressAt = Date.now();
          } else if (payload.type === 'error') {
            // Backend-level fatal error reported: treat as fatal but do not forward raw text.
            console.error('Backend fatal error:', payload.message || payload);
            // mark lastProgressAt so deadlock timer won't trigger additionally
            lastProgressAt = Date.now();
            // record lastData as null so close handler will reject
          }
        } catch (err) {
          console.warn('Non-JSON stdout:', line);
        }
      }
    });

    // Do NOT forward raw stderr to the UI. Backend writes detailed logs to conversion.log
    // We keep stderr output in the main process console for debugging.
    child.stderr.on('data', (chunk) => {
      const message = chunk.toString();
      console.warn('Python stderr:', message.trim());
      // Do not forward stderr to UI; keep logging only.
    });

    // start deadlock timer: only trigger a fatal UI message if no meaningful progress is seen
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
          // attempt to terminate the child cleanly
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
      // process trailing stdout buffer if it is a single JSON line without newline
      if (stdoutBuffer.trim()) {
        try {
          const payload = JSON.parse(stdoutBuffer.trim());
          if (payload.type === 'result') {
            lastData = payload;
          }
        } catch (err) {
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

app.whenReady().then(() => {
  createWindow();

  const configPath = path.join(app.getPath('userData'), 'y2mp3-config.json');

  function readConfig() {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Failed to read config', e);
    }
    return {};
  }

  function writeConfig(cfg) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
      return true;
    } catch (e) {
      console.warn('Failed to write config', e);
      return false;
    }
  }

  ipcMain.handle('select-output-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '저장 폴더 선택',
      properties: ['openDirectory'],
      defaultPath: path.join(__dirname, 'downloads'),
    });
    if (canceled || !filePaths.length) {
      return null;
    }
    return filePaths[0];
  });

  ipcMain.handle('get-default-output-path', () => {
    const cfg = readConfig();
    if (cfg && cfg.defaultOutputPath && fs.existsSync(cfg.defaultOutputPath)) {
      return cfg.defaultOutputPath;
    }
    return path.join(__dirname, 'downloads');
  });

  ipcMain.handle('set-default-output-path', async (event, p) => {
    const cfg = readConfig();
    cfg.defaultOutputPath = p;
    const ok = writeConfig(cfg);
    return ok;
  });

  const { shell } = require('electron');
  // Open an output folder in the system file explorer. If a file path is provided,
  // reveal the file; if a folder path is provided, open the folder.
  ipcMain.handle('open-output-folder', async (event, p) => {
    try {
      if (!p) return { success: false, error: '경로가 제공되지 않았습니다.' };
      const abs = path.isAbsolute(p) ? p : path.join(__dirname, p);
      if (!fs.existsSync(abs)) return { success: false, error: '지정된 경로를 찾을 수 없습니다.' };
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        const res = await shell.openPath(abs);
        if (res) return { success: false, error: res };
        return { success: true };
      } else {
        // reveal the file in explorer
        const ok = shell.showItemInFolder(abs);
        return { success: ok };
      }
    } catch (e) {
      console.warn('open-output-folder failed', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('convert-video', async (event, url, outputDir, bitrate) => {
    try {
      const result = await startPythonConversion(url, outputDir || path.join(__dirname, 'downloads'), bitrate || '192k');
      return { success: true, result };
    } catch (error) {
      // Only mark as fatal if the startPythonConversion error has a fatal flag
      const fatal = error && error.fatal === true;
      if (fatal) {
        return { success: false, fatal: true, error: '치명적 오류가 발생했습니다. 변환 로그(conversion.log)를 확인하세요.' };
      }
      // Non-fatal failures should not present the long conversion log message to the user.
      return { success: false, fatal: false, error: null };
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
