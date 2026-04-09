const { BrowserWindow } = require('electron');
const path = require('path');

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 700,
    height: 540,
    minWidth: 400,
    minHeight: 400,
    title: 'Y2MP3 Desktop',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));

  return mainWindow;
}

module.exports = {
  createMainWindow,
};
