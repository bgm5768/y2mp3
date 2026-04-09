import { getDomElements } from './modules/dom.js';
import { createStatusController } from './modules/status.js';
import { createConversionController } from './modules/conversion.js';

const dom = getDomElements();
const status = createStatusController(dom);
const conversion = createConversionController({ dom, status });

window.addEventListener('DOMContentLoaded', async () => {
  await conversion.restoreDefaultOutputPath();
});

conversion.bindEvents();
window.electronAPI.onProgress(status.onConversionProgress);
