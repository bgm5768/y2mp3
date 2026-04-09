import { getDomElements } from './modules/dom.js';
import { createStatusController } from './modules/status.js';
import { createConversionController } from './modules/conversion.js';

const dom = getDomElements();
const status = createStatusController(dom);
const conversion = createConversionController({ dom, status });

window.addEventListener('DOMContentLoaded', async () => {
  await conversion.restoreDefaultOutputPath();
  // initialize a friendly 'ready' UI before any conversion starts
  if (status && typeof status.setReady === 'function') {
    status.setReady();
  }
});

conversion.bindEvents();
window.electronAPI.onProgress(status.onConversionProgress);
