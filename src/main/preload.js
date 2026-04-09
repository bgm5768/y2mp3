const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  convertVideo: (url, outputDir, bitrate) => ipcRenderer.invoke('convert-video', url, outputDir, bitrate),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  getDefaultOutputPath: () => ipcRenderer.invoke('get-default-output-path'),
  setDefaultOutputPath: (p) => ipcRenderer.invoke('set-default-output-path', p),
  openOutputFolder: (p) => ipcRenderer.invoke('open-output-folder', p),
  onProgress: (callback) => {
    ipcRenderer.on('conversion-progress', (event, payload) => callback(payload));
  },
});
