/**
 * 유튜브 MP3 클라우드 저장 익스텐션 (v1.2 - 라이브 체크 & 실시간 UI 대응)
 */

function showStatusToast(message, isLoading = false) {
    let toast = document.getElementById('yt-mp3-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'yt-mp3-toast';
        document.body.appendChild(toast);
    }

    Object.assign(toast.style, {
        position: 'fixed', bottom: '50px', left: '50%', transform: 'translateX(-50%)',
        backgroundColor: '#282828', color: '#ffffff', padding: '14px 24px',
        borderRadius: '12px', fontSize: '14px', zUnit: '10000',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
        transition: 'all 0.3s ease', opacity: '1', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        minWidth: '300px', border: '1px solid #444', textAlign: 'center', zIndex: '10000'
    });

    const progressBar = isLoading ?
        `<div style="width: 100%; height: 4px; background: #444; border-radius: 2px; overflow: hidden; margin-top: 5px;">
            <div id="toast-bar" style="width: 10%; height: 100%; background: #ff0000; transition: width 1.5s ease-in-out;"></div>
         </div>` : '';

    toast.innerHTML = `<div>${message}</div>${progressBar}`;

    if (!isLoading) {
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => { if(toast) toast.remove(); }, 300);
        }, 4000);
    }
}

function injectCloudButton() {
    if (document.getElementById('yt-mp3-cloud-saver-btn')) return;

    const btnGroup = document.querySelector('#top-level-buttons-computed');
    if (btnGroup) {
        const myBtn = document.createElement('button');
        myBtn.id = 'yt-mp3-cloud-saver-btn';
        myBtn.innerHTML = `☁️ <span style="margin-left:6px">클라우드 저장</span>`;

        myBtn.style.cssText = `
            background-color: rgba(255, 255, 255, 0.1); color: #f1f1f1; border: none;
            padding: 0 16px; height: 36px; border-radius: 18px; margin-left: 8px;
            cursor: pointer; font-size: 14px; font-weight: 500; display: flex; align-items: center;
        `;

        myBtn.addEventListener('click', async () => {
            myBtn.disabled = true;
            showStatusToast('MP3 변환 중...', true);

            try {
                const videoUrl = window.location.href;
                if (!ffmpeg.isLoaded()) {
                    await ffmpeg.load();
                }

                const response = await fetch(videoUrl);
                const videoData = await response.blob();

                ffmpeg.FS('writeFile', 'input.mp4', new Uint8Array(await videoData.arrayBuffer()));
                await ffmpeg.run('-i', 'input.mp4', 'output.mp3');

                const mp3Data = ffmpeg.FS('readFile', 'output.mp3');
                const mp3Blob = new Blob([mp3Data.buffer], { type: 'audio/mpeg' });
                const mp3Url = URL.createObjectURL(mp3Blob);

                const a = document.createElement('a');
                a.href = mp3Url;
                a.download = 'output.mp3';
                a.click();

                showStatusToast('MP3 파일이 성공적으로 저장되었습니다!');
            } catch (error) {
                console.error('변환 중 오류 발생:', error);
                showStatusToast('변환 중 오류가 발생했습니다.');
            } finally {
                myBtn.disabled = false;
            }
        });

        btnGroup.appendChild(myBtn);
    }
}

injectCloudButton();