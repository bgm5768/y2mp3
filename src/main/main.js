const { app, ipcMain, dialog, shell } = require('electron');
const path = require('path');

const { createMainWindow } = require('./window/createMainWindow');
const { createConfigStore } = require('./services/configStore');
const { startPythonDownload } = require('./services/pythonDownloadService');
const { registerHandlers } = require('./ipc/registerHandlers');

let mainWindow;

app.whenReady().then(() => {
  mainWindow = createMainWindow();

  const configStore = createConfigStore(path.join(app.getPath('userData'), 'y2mp3-config.json'));
  const defaultDownloadsPath = path.join(__dirname, 'downloads');

  registerHandlers({
    ipcMain,
    dialog,
    shell,
    mainWindow,
    configStore,
    defaultDownloadsPath,
    relativePathBase: __dirname,
    startDownload: ({ url, outputDir, bitrate }) =>
      startPythonDownload({
        mainWindow,
        url,
        outputDir,
        bitrate,
      }),
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
