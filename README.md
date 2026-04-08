# Y2MP3 Desktop

Electron 기반 데스크톱 앱으로, YouTube 영상 URL을 입력하면 로컬에서 MP3로 변환하여 저장합니다.

## 설치

1. Python 설치
2. `backend/requirements.txt` 설치

```bash
python -m pip install -r backend/requirements.txt
```

3. Node.js 설치
4. Electron 설치 및 실행

```bash
npm install
npm start
```

## 사용법

- 앱을 실행한 뒤 YouTube 동영상 URL을 입력합니다.
- `MP3 변환` 버튼을 누르면 로컬 `downloads` 폴더로 MP3가 저장됩니다.
	- `저장 위치 선택` 버튼으로 저장 폴더를 변경할 수 있습니다.

## 주의

- FFmpeg가 시스템 PATH에 있어야 합니다.
- Python `yt-dlp` 모듈이 필요합니다.
	- Windows: https://ffmpeg.org/download.html
	- macOS / Linux: 패키지 매니저로 설치하거나 경로에 ffmpeg 바이너리를 추가하세요.
 - 배포 시에는 FFmpeg를 앱 폴더 안에 함께 넣을 수 있습니다.
	 - Windows: `ffmpeg/ffmpeg.exe` 또는 `ffmpeg.exe`
	 - macOS/Linux: `ffmpeg/ffmpeg` 또는 `ffmpeg`
	 - 이 프로젝트는 해당 경로에 FFmpeg가 있으면 자동으로 사용합니다.
