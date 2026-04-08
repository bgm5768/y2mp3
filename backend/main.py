from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import yt_dlp
import os
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 크롬 익스텐션과의 통신 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DOWNLOAD_DIR = "downloads"
if not os.path.exists(DOWNLOAD_DIR):
    os.makedirs(DOWNLOAD_DIR)

class VideoItem(BaseModel):
    url: str

@app.post("/convert")
async def convert_video(item: VideoItem):
    url = item.url
    
    # 1. 사전 검사 (라이브 여부 및 길이 체크)
    with yt_dlp.YoutubeDL({'quiet': True, 'noplaylist': True}) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
            
            # 라이브 영상 체크
            if info.get('is_live') or info.get('live_status') == 'is_live':
                raise HTTPException(
                    status_code=400, 
                    detail="라이브 스트리밍 영상은 저장할 수 없습니다."
                )

            # 30분(1800초) 제한 체크
            duration = info.get('duration', 0)
            MAX_SEC = 1800 
            if duration > MAX_SEC:
                raise HTTPException(
                    status_code=400, 
                    detail=f"30분 이하의 영상만 가능합니다. (현재: {duration//60}분)"
                )
        except Exception as e:
            if isinstance(e, HTTPException): raise e
            raise HTTPException(status_code=500, detail="유튜브 정보를 분석할 수 없습니다.")

    # 2. 실제 다운로드 및 MP3 변환
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'outtmpl': f'{DOWNLOAD_DIR}/%(title)s.%(ext)s',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'ffmpeg_location': '.', 
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=True)
            video_title = info_dict.get('title', 'music_file')
            return {"status": "success", "title": video_title}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"변환 실패: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)