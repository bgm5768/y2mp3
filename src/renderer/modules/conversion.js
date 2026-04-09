export function createConversionController({ dom, status }) {
  const state = {
    polling: false,
    selectedOutputPath: '',
  };

  function setControlsDisabled(disabled) {
    try {
      if (dom.videoUrlInput) dom.videoUrlInput.disabled = disabled;
      if (dom.qualitySelect) dom.qualitySelect.disabled = disabled;
      if (dom.convertButton) dom.convertButton.disabled = disabled;
      if (dom.selectFolderButton) dom.selectFolderButton.disabled = disabled;
      // Keep the open-folder button always enabled per UX request
      if (dom.openFolderButton) dom.openFolderButton.disabled = false;
      // output path input is readonly; disable for clarity during conversion
      if (dom.outputPathInput) dom.outputPathInput.disabled = disabled;
    } catch (e) {
      console.warn('Failed to toggle controls', e);
    }
  }

  async function startConversion() {
    const url = dom.videoUrlInput.value.trim();
    if (!url) {
      status.setStatus('입력 오류', 'YouTube URL을 입력해주세요.', 0, '#f44336');
      return;
    }

    if (state.polling) {
      return;
    }

    dom.outputInfo.textContent = '';
    const bitrate = dom.qualitySelect && dom.qualitySelect.value ? dom.qualitySelect.value : '192k';

    status.setStatus(
      '다운로드 준비',
      `URL을 확인하고 다운로드를 시작합니다... (음질: ${bitrate})`,
      5,
      '#9e9e9e',
      '대기/검증',
    );

    // disable UI controls while conversion is running
    setControlsDisabled(true);
    state.polling = true;

    try {
      const response = await window.electronAPI.convertVideo(url, state.selectedOutputPath, bitrate);

      if (!response.success) {
        if (response.fatal) {
          status.setStatus('오류 발생', response.error || '다운로드 중 치명적 오류가 발생했습니다.', 0, '#f44336', '실패');
        } else {
          status.setStatus('완료되지 않음', '다운로드가 중단되었거나 완료되지 않았습니다.', 100, '#ff9800', '완료');
        }
        state.polling = false;
        return;
      }

      const result = response.result;
      if (result && result.outputPath) {
        status.setStatus('다운로드 완료', '파일이 저장되었습니다.', 100, '#4caf50', '완료');
        dom.outputInfo.textContent = `저장 위치: ${result.outputPath}`;
      } else {
        status.setStatus('완료', '처리가 완료되었습니다.', 100, '#4caf50', '완료');
      }
    } catch (error) {
      console.error(error);
      status.setStatus('오류 발생', '다운로드 처리 중 오류가 발생했습니다.', 0, '#f44336', '실패');
    } finally {
      state.polling = false;
      // re-enable UI controls after conversion attempt finishes
      setControlsDisabled(false);
    }
  }

  async function selectFolder() {
    const folder = await window.electronAPI.selectOutputFolder();
    if (!folder) return;

    state.selectedOutputPath = folder;
    dom.outputPathInput.value = folder;
    dom.outputInfo.textContent = `저장 폴더: ${folder}`;

    try {
      await window.electronAPI.setDefaultOutputPath(folder);
    } catch (e) {
      console.warn('Failed to persist default output path', e);
    }
  }

  async function openFolder() {
    const pathToOpen = state.selectedOutputPath || dom.outputPathInput.value;
    if (!pathToOpen) {
      // nothing to do if no path — silently return to avoid changing UI
      console.warn('openFolder called but no path selected');
      return;
    }

    try {
      // Open the folder using the main process. Do not update status UI here so
      // progress indicators remain unaffected (per UX requirement).
      await window.electronAPI.openOutputFolder(pathToOpen);
    } catch (e) {
      console.warn('openOutputFolder failed', e);
      // keep UI unchanged on failures to avoid interfering with conversion progress
    }
  }

  async function restoreDefaultOutputPath() {
    const defaultPath = await window.electronAPI.getDefaultOutputPath();
    state.selectedOutputPath = defaultPath;
    dom.outputPathInput.value = defaultPath;
  }

  function bindEvents() {
    dom.convertButton.addEventListener('click', startConversion);
    dom.selectFolderButton.addEventListener('click', selectFolder);

    if (dom.openFolderButton) {
      dom.openFolderButton.addEventListener('click', openFolder);
    }

    dom.videoUrlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        startConversion();
      }
    });
  }

  return {
    bindEvents,
    restoreDefaultOutputPath,
  };
}
