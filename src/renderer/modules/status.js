export function createStatusController(dom) {
  function setStatus(title, text, progress = 0, color = '#4caf50', stage = '진행 중', showProgress = true) {
    const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));

    dom.statusTitle.textContent = title;
    dom.statusText.textContent = text;

    if (dom.stageSubheading) {
      dom.stageSubheading.textContent = title;
    }

    if (dom.stageMeta) {
      dom.stageMeta.textContent = stage;
    }

    if (dom.progressPercent) {
      dom.progressPercent.textContent = showProgress ? `${safeProgress.toFixed(1)}%` : '';
    }

    if (dom.progressFill) {
      if (showProgress) {
        dom.progressFill.style.display = 'block';
        dom.progressFill.style.width = `${safeProgress}%`;
        dom.progressFill.style.background = color;
      } else {
        dom.progressFill.style.display = 'none';
        dom.progressFill.style.width = '0%';
      }
    }
  }

  function onConversionProgress(payload) {
    if (!payload) return;

    const statusKey = payload.status;
    const percent = typeof payload.percent === 'number' ? payload.percent : 0;
    const message = payload.message || '';

    if (statusKey === 'download') {
      setStatus('다운로드 중...', message || `다운로드 중... ${percent}%`, percent, '#42a5f5', '오디오 다운로드', true);
    } else if (statusKey === 'convert') {
      setStatus('처리 중...', message || `처리 중... ${percent}%`, percent, '#4caf50', '처리', true);
    } else if (statusKey === 'completed') {
      setStatus('다운로드 완료', message || '파일 다운로드가 완료되었습니다.', 100, '#4caf50', '완료', false);
      if (payload.outputPath) {
        dom.outputInfo.textContent = `저장 위치: ${payload.outputPath}`;
      }
    } else if (statusKey === 'info') {
      setStatus('정보', message || '', percent || 0, '#2196f3', '환경 정보', false);
    } else if (statusKey === 'error' || payload.type === 'error') {
      setStatus('오류 발생', message || '변환 중 오류가 발생했습니다.', percent || 0, '#f44336', '실패', false);
    }
  }

  function setReady() {
    // Initial 'ready to start' UI state
    if (dom.statusTitle) dom.statusTitle.textContent = '준비 완료';
    if (dom.statusText) dom.statusText.textContent = '유튜브 URL을 입력하고 MP3 변환 버튼을 눌러 시작하세요.';
    if (dom.stageSubheading) dom.stageSubheading.textContent = '준비';
    if (dom.stageMeta) dom.stageMeta.textContent = '대기';
    if (dom.progressPercent) dom.progressPercent.textContent = '';
    if (dom.progressFill) {
      dom.progressFill.style.width = '0%';
      dom.progressFill.style.display = 'none';
    }
  }

  return {
    setStatus,
    onConversionProgress,
    setReady,
  };
}
