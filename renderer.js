const videoUrlInput = document.getElementById('videoUrl');
const convertButton = document.getElementById('convertButton');
const statusTitle = document.getElementById('statusTitle');
const statusText = document.getElementById('statusText');
const stageSubheading = document.getElementById('stageSubheading');
const stageMeta = document.getElementById('stageMeta');
const progressPercent = document.getElementById('progressPercent');
const progressFill = document.getElementById('progressFill');
const outputInfo = document.getElementById('outputInfo');
const outputPathInput = document.getElementById('outputPath');
const selectFolderButton = document.getElementById('selectFolderButton');
const openFolderButton = document.getElementById('openFolderButton');
const qualitySelect = document.getElementById('qualitySelect');

let polling = false;
let selectedOutputPath = '';

// Unified status setter for sequential progress (download -> convert)
function setStatus(title, text, progress = 0, color = '#4caf50', stage = '진행 중') {
  const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  statusTitle.textContent = title;
  statusText.textContent = text;
  if (stageSubheading) {
    // Keep stage heading in sync with title (shortened)
    stageSubheading.textContent = title;
  }
  if (stageMeta) {
    stageMeta.textContent = stage;
  }
  if (progressPercent) {
    progressPercent.textContent = `${safeProgress.toFixed(1)}%`;
  }
  if (progressFill) {
    progressFill.style.width = `${safeProgress}%`;
    progressFill.style.background = color;
  }
}

function onConversionProgress(payload) {
  if (!payload) return;

  // payload: { type: 'progress', status: 'download'|'convert'|'completed'|'error', percent: <num>, message: <str> }
  const status = payload.status;
  const percent = typeof payload.percent === 'number' ? payload.percent : 0;
  const message = payload.message || '';

  if (status === 'download') {
    // Show download percent 0 -> 100
    setStatus('다운로드 중...', message || `다운로드 중... ${percent}%`, percent, '#42a5f5', '1/2 단계: 오디오 다운로드');
  // no ETA/ffmpeg info displayed in UI
  } else if (status === 'convert') {
    // When convert messages start coming, show conversion percent (backend starts from 0)
    // Reset progress bar to the conversion percent coming from backend.
    setStatus('MP3 변환 중...', message || `MP3 변환 중... ${percent}%`, percent, '#4caf50', '2/2 단계: MP3 변환');
  // backend no longer sends ETA or ffmpeg_line to the UI
  } else if (status === 'completed') {
    setStatus('변환 완료', message || 'MP3 변환이 완료되었습니다.', 100, '#4caf50', '완료');
    if (payload.outputPath) {
      outputInfo.textContent = `저장 위치: ${payload.outputPath}`;
    }
  // no ETA/ffmpeg info to clear
  } else if (status === 'info') {
    // informational messages (e.g., using bundled ffmpeg)
    setStatus('정보', message || '', percent || 0, '#2196f3', '환경 정보');
  // do not show ffmpeg_line warnings in UI
  } else if (status === 'error' || payload.type === 'error') {
    setStatus('오류 발생', message || '변환 중 오류가 발생했습니다.', percent || 0, '#f44336', '실패');
    // no ETA or ffmpeg_line displayed
  }
}

async function startConversion() {
  const url = videoUrlInput.value.trim();
  if (!url) {
    setStatus('입력 오류', 'YouTube URL을 입력해주세요.', 0, '#f44336');
    return;
  }

  if (polling) {
    return;
  }

  outputInfo.textContent = '';
  const bitrate = (qualitySelect && qualitySelect.value) ? qualitySelect.value : '192k';
  setStatus('변환 준비', `URL을 확인하고 변환을 시작합니다... (음질: ${bitrate})`, 5, '#9e9e9e', '대기/검증');
  polling = true;

  try {
    const response = await window.electronAPI.convertVideo(url, selectedOutputPath, bitrate);
    if (!response.success) {
      // Only show an explicit error message when the main process marks the error as fatal.
      if (response.fatal) {
        setStatus('오류 발생', response.error || '변환 중 치명적 오류가 발생했습니다.', 0, '#f44336', '실패');
      } else {
        // Non-fatal: avoid scaring the user; show neutral completion state.
        setStatus('완료되지 않음', '변환이 중단되었거나 완료되지 않았습니다.', 100, '#ff9800', '완료');
      }
      polling = false;
      return;
    }

    const result = response.result;
    if (result && result.outputPath) {
      setStatus('변환 완료', 'MP3 파일이 저장되었습니다.', 100, '#4caf50', '완료');
      outputInfo.textContent = `저장 위치: ${result.outputPath}`;
    } else {
      setStatus('완료', '변환이 완료되었습니다.', 100, '#4caf50', '완료');
    }
  } catch (error) {
    console.error(error);
    setStatus('오류 발생', '변환 처리 중 오류가 발생했습니다.', 0, '#f44336', '실패');
  } finally {
    polling = false;
  }
}

convertButton.addEventListener('click', startConversion);
selectFolderButton.addEventListener('click', async () => {
  const folder = await window.electronAPI.selectOutputFolder();
  if (folder) {
    selectedOutputPath = folder;
    outputPathInput.value = folder;
    outputInfo.textContent = `저장 폴더: ${folder}`;
    // persist the selected folder so it's restored next time
    try {
      await window.electronAPI.setDefaultOutputPath(folder);
    } catch (e) {
      console.warn('Failed to persist default output path', e);
    }
  }
});

if (openFolderButton) {
  openFolderButton.addEventListener('click', async () => {
    const pathToOpen = selectedOutputPath || outputPathInput.value;
    if (!pathToOpen) {
      setStatus('오류', '먼저 저장 위치를 선택하세요.', 0, '#f44336');
      return;
    }
    try {
      const res = await window.electronAPI.openOutputFolder(pathToOpen);
      if (res && res.success) {
        setStatus('폴더 열기', '저장 위치를 탐색기에서 열었습니다.', 0, '#2196f3');
      } else {
        setStatus('오류', res && res.error ? res.error : '폴더를 열 수 없습니다.', 0, '#f44336');
      }
    } catch (e) {
      console.warn('openOutputFolder failed', e);
      setStatus('오류', '폴더 열기 중 오류가 발생했습니다.', 0, '#f44336');
    }
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  const defaultPath = await window.electronAPI.getDefaultOutputPath();
  selectedOutputPath = defaultPath;
  outputPathInput.value = defaultPath;
});
videoUrlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    startConversion();
  }
});

window.electronAPI.onProgress(onConversionProgress);
