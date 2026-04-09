export function getDomElements() {
  return {
    videoUrlInput: document.getElementById('videoUrl'),
    convertButton: document.getElementById('convertButton'),
    statusTitle: document.getElementById('statusTitle'),
    statusText: document.getElementById('statusText'),
    stageSubheading: document.getElementById('stageSubheading'),
    stageMeta: document.getElementById('stageMeta'),
    progressPercent: document.getElementById('progressPercent'),
    progressFill: document.getElementById('progressFill'),
    outputInfo: document.getElementById('outputInfo'),
    outputPathInput: document.getElementById('outputPath'),
    selectFolderButton: document.getElementById('selectFolderButton'),
    openFolderButton: document.getElementById('openFolderButton'),
    qualitySelect: document.getElementById('qualitySelect'),
  };
}
