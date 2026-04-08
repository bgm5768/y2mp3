/**
 * 유튜브 MP3 클라우드 저장 익스텐션 (v2.0 - 현대적 UI & 비동기 프로그래스)
 */

function createProgressUI() {
    let container = document.getElementById('yt-mp3-progress-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'yt-mp3-progress-container';
        document.body.appendChild(container);

        const style = document.createElement('style');
        style.textContent = `
            #yt-mp3-progress-container {
                position: fixed; bottom: 30px; right: 30px; z-index: 99999;
                background: #1e1e1e; color: white; padding: 16px; border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #333;
                width: 320px; transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                opacity: 0; transform: translateY(100px); font-family: "Roboto", sans-serif;
            }
            #yt-mp3-progress-container.show { opacity: 1; transform: translateY(0); }
            .mp3-progress-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
            .mp3-progress-title { font-size: 14px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
            .mp3-progress-bar-bg { width: 100%; height: 6px; background: #333; border-radius: 3px; overflow: hidden; }
            .mp3-progress-bar-fill { width: 0%; height: 100%; background: #ff0000; transition: width 0.3s ease; }
            .mp3-progress-status { font-size: 12px; margin-top: 8px; color: #aaa; text-align: center; }
            .mp3-close-btn { cursor: pointer; color: #888; font-size: 18px; }
        `;
        document.head.appendChild(style);
    }
    
    container.innerHTML = `
        <div class="mp3-progress-header">
            <span class="mp3-progress-title">MP3 변환 시작...</span>
            <span class="mp3-close-btn">&times;</span>
        </div>
        <div class="mp3-progress-bar-bg">
            <div class="mp3-progress-bar-fill"></div>
        </div>
        <div class="mp3-progress-status">Initializing...</div>
    `;

    container.querySelector('.mp3-close-btn').onclick = () => {
        container.classList.remove('show');
    };

    return container;
}

function updateUI(container, data) {
    const title = container.querySelector('.mp3-progress-title');
    const bar = container.querySelector('.mp3-progress-bar-fill');
    const status = container.querySelector('.mp3-progress-status');

    if (data.status === 'completed') {
        title.textContent = data.title || '변환 완료';
        bar.style.width = '100%';
        bar.style.background = '#4caf50';
        status.textContent = '변환 완료! MP3 파일을 준비 중입니다...';
        
        setTimeout(() => {
            if (container) {
                container.classList.remove('show');
                setTimeout(() => container.remove(), 400);
            }
        }, 5000);
    } else if (data.status === 'failed') {
        title.textContent = '오류 발생';
        bar.style.width = '100%';
        bar.style.background = '#f44336';
        status.textContent = data.message || '알 수 없는 오류가 발생했습니다.';
        status.style.color = '#ff5252';
        
        setTimeout(() => {
            if (container) {
                container.classList.remove('show');
                setTimeout(() => container.remove(), 400);
            }
        }, 8000);
    } else {
        // progress status
        if (data.title && data.title !== "분석 중...") {
            title.textContent = data.title;
        }
        bar.style.width = (data.progress || 0) + '%';
        status.textContent = data.message || '대기 중...';
    }
}

async function startPolling(taskId, container) {
    const pollUrl = `http://127.0.0.1:8000/poll/${taskId}`;
    
    const interval = setInterval(async () => {
        try {
            const resp = await fetch(pollUrl);
            if (!resp.ok) {
                // Network error (backend down?)
                updateUI(container, { status: 'failed', message: '백엔드 서버에 연결할 수 없습니다.' });
                clearInterval(interval);
                return;
            }
            const data = await resp.json();
            
            updateUI(container, data);

            if (data.status === 'completed') {
                clearInterval(interval);
                triggerDownload(data.downloadUrl, data.title);
            } else if (data.status === 'failed') {
                clearInterval(interval);
            }
        } catch (e) {
            console.error('Polling error:', e);
            updateUI(container, { status: 'failed', message: '네트워크 연결 오류: ' + e.message });
            clearInterval(interval);
        }
    }, 1500);
}

async function triggerDownload(url, title) {
    try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${title || 'music'}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
    } catch (e) {
        console.error('Download error:', e);
    }
}

function injectCloudButton() {
    if (document.getElementById('yt-mp3-cloud-saver-btn')) return;

    const btnGroup = document.querySelector('#top-level-buttons-computed');
    if (btnGroup) {
        const myBtn = document.createElement('button');
        myBtn.id = 'yt-mp3-cloud-saver-btn';
        myBtn.innerHTML = `🎵 <span style="margin-left:6px">MP3 저장</span>`;
        myBtn.style.cssText = `
            background: rgba(255, 255, 255, 0.08) !important; color: #fff !important; border: 1px solid rgba(255, 255, 255, 0.12) !important; padding: 0 14px;
            height: 36px; border-radius: 18px; margin-left: 8px; cursor: pointer;
            font-size: 14px; font-weight: 500; display: flex; align-items: center;
            box-shadow: none;
            transition: background-color 0.2s ease, transform 0.2s ease;
        `;

        myBtn.onmouseover = () => {
            myBtn.style.setProperty('background', 'rgba(255, 255, 255, 0.14)', 'important');
        };
        myBtn.onmouseout = () => {
            myBtn.style.setProperty('background', 'rgba(255, 255, 255, 0.08)', 'important');
        };
        myBtn.onmousedown = () => {
            myBtn.style.transform = 'scale(0.98)';
        };
        myBtn.onmouseup = () => {
            myBtn.style.transform = 'scale(1)';
        };

        myBtn.onclick = async () => {
            const container = createProgressUI();
            container.classList.add('show');
            
            try {
                const resp = await fetch('http://127.0.0.1:8000/convert', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ url: window.location.href })
                });
                if (!resp.ok) {
                    const errorData = await resp.json().catch(() => null);
                    updateUI(container, {
                        status: 'failed',
                        message: errorData?.detail || '서버 요청에 실패했습니다.'
                    });
                    return;
                }
                const data = await resp.json();
                if (data.task_id) {
                    startPolling(data.task_id, container);
                }
            } catch (e) {
                console.error('Start error:', e);
                updateUI(container, { status: 'failed', message: '요청 중 오류가 발생했습니다.' });
            }
        };

        btnGroup.appendChild(myBtn);
    } else {
        setTimeout(injectCloudButton, 1000);
    }
}

// Watch navigation
let lastUrl = location.href;
setInterval(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        injectCloudButton();
    }
}, 1000);

// If YouTube replaces the button container without changing the URL, re-inject automatically.
const bodyObserver = new MutationObserver(() => {
    if (!document.getElementById('yt-mp3-cloud-saver-btn')) {
        injectCloudButton();
    }
});
bodyObserver.observe(document.body, { childList: true, subtree: true });

injectCloudButton();