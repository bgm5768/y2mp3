export function createConversionController({ dom, status }) {
  const state = {
    polling: false,
    selectedOutputPath: '',
  };

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
      status.setStatus('오류', '먼저 저장 위치를 선택하세요.', 0, '#f44336');
      return;
    }

    try {
      const res = await window.electronAPI.openOutputFolder(pathToOpen);
      if (res && res.success) {
        status.setStatus('폴더 열기', '저장 위치를 탐색기에서 열었습니다.', 0, '#2196f3');
      } else {
        status.setStatus('오류', res && res.error ? res.error : '폴더를 열 수 없습니다.', 0, '#f44336');
      }
    } catch (e) {
      console.warn('openOutputFolder failed', e);
      status.setStatus('오류', '폴더 열기 중 오류가 발생했습니다.', 0, '#f44336');
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
