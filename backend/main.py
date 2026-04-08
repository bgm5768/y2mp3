from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
import yt_dlp
import os
import glob
import urllib.parse
import re
import uuid
import time
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# Task storage: {task_id: {"status": "pending", "progress": 0, "title": "", "downloadUrl": "", "message": ""}}
tasks = {}

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DOWNLOAD_DIR = "downloads"
if not os.path.exists(DOWNLOAD_DIR):
    os.makedirs(DOWNLOAD_DIR)

app.mount("/downloads", StaticFiles(directory=DOWNLOAD_DIR), name="downloads")

class VideoItem(BaseModel):
    url: str

def sanitize_filename(name):
    return re.sub(r'[\\/*?:"<>|]', '_', name).strip()

def download_task(task_id: str, url: str):
    tasks[task_id]["status"] = "processing"
    tasks[task_id]["message"] = "사전 검사 중..."
    
    def progress_hook(d):
        if d['status'] == 'downloading':
            p = d.get('_percent_str', '0%').replace('%','').strip()
            try:
                tasks[task_id]["progress"] = float(p) * 0.8  # Download is 80% of total
                tasks[task_id]["message"] = f"다운로드 중... {p}%"
            except: pass
        elif d['status'] == 'finished':
            tasks[task_id]["progress"] = 80
            tasks[task_id]["message"] = "MP3 변환 중..."

    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'outtmpl': f'{DOWNLOAD_DIR}/%(id)s.%(ext)s',
        'progress_hooks': [progress_hook],
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'ffmpeg_location': '.', 
    }
    try:
        with yt_dlp.YoutubeDL({'quiet': True, 'noplaylist': True}) as ydl:
            info = ydl.extract_info(url, download=False)
            if info is None:
                tasks[task_id]["status"] = "failed"
                tasks[task_id]["message"] = "동영상을 분석할 수 없습니다."
                return

            if info.get('is_live') or info.get('live_status') == 'is_live':
                tasks[task_id]["status"] = "failed"
                tasks[task_id]["message"] = "라이브 스트리밍 영상은 저장할 수 없습니다."
                return

            duration = info.get('duration', 0) or 0
            if duration > 1800:
                tasks[task_id]["status"] = "failed"
                tasks[task_id]["message"] = f"30분 이하의 영상만 가능합니다. (현재: {duration//60}분)"
                return
            tasks[task_id]["message"] = "다운로드 준비 중..."
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # First extract info - this is where it might fail if video is unavailable
            info = ydl.extract_info(url, download=True)
            
            if info is None:
                tasks[task_id]["status"] = "failed"
                tasks[task_id]["message"] = "동영상 정보를 가져올 수 없습니다. (비공개 또는 삭제된 영상)"
                return

            video_title = info.get('title', 'music_file')
            video_id = info.get('id', 'unknown')
            
            # Find the actual mp3 file
            pattern = os.path.join(DOWNLOAD_DIR, f"{video_id}.mp3")
            candidates = glob.glob(pattern)
            
            if candidates:
                final_file = candidates[0]
                file_basename = os.path.basename(final_file)
                tasks[task_id]["downloadUrl"] = f"http://127.0.0.1:8000/downloads/{urllib.parse.quote(file_basename)}"
                tasks[task_id]["status"] = "completed"
                tasks[task_id]["title"] = video_title
                tasks[task_id]["progress"] = 100
                tasks[task_id]["message"] = "변환 완료!"
            else:
                tasks[task_id]["status"] = "failed"
                tasks[task_id]["message"] = "파일을 찾을 수 없습니다."

    except Exception as e:
        error_msg = str(e)
        normalized = error_msg.lower()
        if "this video is not available" in normalized or "video unavailable" in normalized:
            tasks[task_id]["message"] = "동영상을 사용할 수 없습니다."
        elif "private video" in normalized or "this video is private" in normalized:
            tasks[task_id]["message"] = "비공개 동영상입니다."
        elif "sign in to confirm your age" in normalized or "age-restricted" in normalized:
            tasks[task_id]["message"] = "연령 제한이 걸린 동영상입니다."
        else:
            tasks[task_id]["message"] = f"변환 오류: {error_msg}"
        tasks[task_id]["status"] = "failed"
        print(f"Task {task_id} failed: {error_msg}")

@app.post("/convert")
async def start_convert(item: VideoItem, background_tasks: BackgroundTasks):
    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "status": "pending", 
        "progress": 0, 
        "title": "분석 중...", 
        "downloadUrl": "", 
        "message": "작업 시작..."
    }
    background_tasks.add_task(download_task, task_id, item.url)
    return {"task_id": task_id}

@app.get("/poll/{task_id}")
async def poll_task(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    return tasks[task_id]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)