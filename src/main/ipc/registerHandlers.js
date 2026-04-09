const path = require('path');
const fs = require('fs');

function registerHandlers({
  ipcMain,
  dialog,
  shell,
  mainWindow,
  configStore,
  startDownload,
  defaultDownloadsPath,
  relativePathBase,
}) {
  ipcMain.handle('select-output-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '저장 폴더 선택',
      properties: ['openDirectory'],
      defaultPath: defaultDownloadsPath,
    });

    if (canceled || !filePaths.length) {
      return null;
    }

    return filePaths[0];
  });

  ipcMain.handle('get-default-output-path', () => {
    const cfg = configStore.readConfig();
    if (cfg && cfg.defaultOutputPath && fs.existsSync(cfg.defaultOutputPath)) {
      return cfg.defaultOutputPath;
    }
    return defaultDownloadsPath;
  });

  ipcMain.handle('set-default-output-path', async (event, selectedPath) => {
    const cfg = configStore.readConfig();
    cfg.defaultOutputPath = selectedPath;
    return configStore.writeConfig(cfg);
  });

  ipcMain.handle('open-output-folder', async (event, targetPath) => {
    try {
      if (!targetPath) return { success: false, error: '경로가 제공되지 않았습니다.' };
      const abs = path.isAbsolute(targetPath)
        ? targetPath
        : path.join(relativePathBase || __dirname, targetPath);
      if (!fs.existsSync(abs)) return { success: false, error: '지정된 경로를 찾을 수 없습니다.' };

      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        const res = await shell.openPath(abs);
        if (res) return { success: false, error: res };
        return { success: true };
      }

      const ok = shell.showItemInFolder(abs);
      return { success: ok };
    } catch (e) {
      console.warn('open-output-folder failed', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('convert-video', async (event, url, outputDir, bitrate) => {
    try {
      const result = await startDownload({
        url,
        outputDir: outputDir || defaultDownloadsPath,
        bitrate: bitrate || '192k',
      });

      return { success: true, result };
    } catch (error) {
      const fatal = error && error.fatal === true;
      if (fatal) {
        return {
          success: false,
          fatal: true,
          error: '치명적 오류가 발생했습니다. 변환 로그(conversion.log)를 확인하세요.',
        };
      }
      return { success: false, fatal: false, error: null };
    }
  });
}

module.exports = {
  registerHandlers,
};
