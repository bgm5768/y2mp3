import argparse
import json
import os
import re
import sys
import subprocess
import threading

try:
    import yt_dlp
except ImportError:
    print(json.dumps({"type": "error", "message": "yt_dlp 모듈이 설치되어 있지 않습니다. requirements.txt를 확인하세요."}))
    sys.exit(1)


def sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/*?"<>|]', '_', name).strip()


def print_progress(status: str, percent: float = 0.0, message: str = '', extra: dict = None):
    payload = {
        'type': 'progress',
        'status': status,
        'percent': percent,
        'message': message,
    }
    if extra and isinstance(extra, dict):
        for k, v in extra.items():
            if k not in payload:
                payload[k] = v
    print(json.dumps(payload), flush=True)


    

def main():
    parser = argparse.ArgumentParser(description='Download best-audio from a YouTube URL using yt-dlp.')
    parser.add_argument('--url', required=True, help='YouTube video URL')
    parser.add_argument('--output', required=True, help='Output directory for downloaded files')
    parser.add_argument('--cookies', help='Path to cookies.txt to pass to yt-dlp', default=None)
    parser.add_argument('--extractor-args', help='Extractor args (JSON or simple form like "youtube:player_client=android,web")', default=None)
    parser.add_argument('--bitrate', help='Suggested bitrate label (kept for compatibility)', default='192k')
    args = parser.parse_args()

    url = args.url.strip()
    output_dir = os.path.abspath(args.output)
    os.makedirs(output_dir, exist_ok=True)

    # logfile for ongoing messages and errors
    log_path = os.path.join(output_dir, 'conversion.log')

    def log_message(level: str, msg: str):
        try:
            with open(log_path, 'a', encoding='utf-8') as f:
                from datetime import datetime, timezone

                ts = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S %Z')
                f.write(f"[{ts}] {level.upper()}: {msg}\n")
        except Exception:
            pass

    def extract_video_id_from_url(u: str):
        m = re.search(r'(?:v=|youtu\.be/|youtube\.com/watch\?v=)([A-Za-z0-9_-]{11})', u)
        if m:
            return m.group(1)
        if re.fullmatch(r'[A-Za-z0-9_-]{11}', u):
            return u
        return None

    vid = extract_video_id_from_url(url)
    if not vid:
        err_msg = (
            f"잘못된 또는 잘라진 YouTube URL/ID입니다: {url}.\n"
            "전체 watch URL(예: https://www.youtube.com/watch?v=VIDEO_ID) 또는 유효한 11자의 비디오 ID를 제공하세요."
        )
        try:
            log_message('error', err_msg)
        except Exception:
            pass
        print(json.dumps({'type': 'error', 'message': err_msg}), flush=True)
        sys.exit(1)

    def parse_extractor_args(s: str):
        if not s:
            return None
        s = s.strip()
        try:
            obj = json.loads(s)
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass

        result = {}
        for entry in s.split(';'):
            entry = entry.strip()
            if not entry:
                continue
            if ':' not in entry or '=' not in entry:
                continue
            extractor, rest = entry.split(':', 1)
            key, val = rest.split('=', 1)
            extractor = extractor.strip()
            key = key.strip()
            val = val.strip()
            if extractor and key:
                result.setdefault(extractor, {})[key] = val
        return result if result else None

    def normalize_extractor_args(raw):
        if not isinstance(raw, dict):
            return None
        out = {}
        for extractor, opts in raw.items():
            if not isinstance(opts, dict):
                out[extractor] = opts
                continue
            out_opts = {}
            for k, v in opts.items():
                if extractor == 'youtube' and k == 'player_client':
                    if isinstance(v, str):
                        out_opts[k] = [x.strip() for x in v.split(',') if x.strip()]
                    elif isinstance(v, (list, tuple)):
                        out_opts[k] = [str(x).strip() for x in v if str(x).strip()]
                    else:
                        out_opts[k] = v
                else:
                    out_opts[k] = v
            out[extractor] = out_opts
        return out

    class YTDLLogger:
        def debug(self, msg):
            log_message('debug', str(msg))

        def info(self, msg):
            log_message('info', str(msg))

        def warning(self, msg):
            log_message('warning', str(msg))

        def error(self, msg):
            log_message('error', str(msg))
            try:
                print_progress('error', 0.0, str(msg), extra={'log_path': log_path})
            except Exception:
                pass

    def progress_hook(d):
        if d.get('status') == 'downloading':
            percent = 0.0
            if d.get('total_bytes'):
                percent = float(d.get('downloaded_bytes', 0)) / float(d.get('total_bytes', 1)) * 100
            elif d.get('total_bytes_estimate'):
                percent = float(d.get('downloaded_bytes', 0)) / float(d.get('total_bytes_estimate', 1)) * 100
            msg = f"다운로드 중... {round(percent, 1)}%"
            print_progress('download', round(percent, 1), msg)
            log_message('info', msg)
        elif d.get('status') == 'finished':
            print_progress('download', 100.0, '다운로드가 완료되었습니다.')
            log_message('info', '다운로드 완료')
        elif d.get('status') == 'error':
            err_msg = d.get('error', '다운로드 중 오류가 발생했습니다.')
            log_message('error', str(err_msg))
            try:
                print_progress('error', 0.0, str(err_msg), extra={'log_path': log_path})
            except Exception:
                pass

    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'outtmpl': os.path.join(output_dir, '%(id)s.%(ext)s'),
        'progress_hooks': [progress_hook],
        'logger': YTDLLogger(),
    }

    if args.cookies:
        cookie_path = os.path.abspath(args.cookies)
        ydl_opts['cookiefile'] = cookie_path
        log_message('info', f'쿠키 파일 사용: {cookie_path}')

    extractor_args = parse_extractor_args(args.extractor_args)
    if extractor_args:
        normalized = normalize_extractor_args(extractor_args)
        ydl_opts['extractor_args'] = normalized
        log_message('info', f'추출기 인자 적용: {normalized}')

    try:
        def attempt_extract(opts):
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=True)

        retry_client_sets = [
            ['android', 'web'],
            ['android'],
            ['web'],
            ['ios', 'web'],
            ['tv', 'web'],
        ]

        try:
            info = attempt_extract(ydl_opts)
        except Exception as e:
            log_message('warning', f'첫 추출 실패: {e}. 클라이언트 조합 자동 재시도를 시작합니다.')
            info = None
            final_err = e

            for clients in retry_client_sets:
                retry_extractor_args = {}
                if 'extractor_args' in ydl_opts and isinstance(ydl_opts['extractor_args'], dict):
                    retry_extractor_args.update(ydl_opts['extractor_args'])

                youtube_opts = retry_extractor_args.get('youtube', {})
                if not isinstance(youtube_opts, dict):
                    youtube_opts = {}
                youtube_opts['player_client'] = clients
                retry_extractor_args['youtube'] = youtube_opts

                ydl_opts_retry = dict(ydl_opts)
                ydl_opts_retry['extractor_args'] = retry_extractor_args

                try:
                    log_message('warning', f'재시도: youtube.player_client={clients}')
                    info = attempt_extract(ydl_opts_retry)
                    if info:
                        log_message('info', f'재시도 성공: youtube.player_client={clients}')
                        break
                except Exception as e2:
                    final_err = e2
                    log_message('error', f'재시도 실패({clients}): {e2}')

            if not info:
                print(json.dumps({'type': 'error', 'message': str(final_err)}), flush=True)
                sys.exit(1)
        if not info:
            raise RuntimeError('변환 정보를 가져오지 못했습니다.')

        title = info.get('title') or 'output'
        safe_title = sanitize_filename(title)

        downloaded_path = info.get('_filename')
        if not downloaded_path or not os.path.isfile(downloaded_path):
            req = info.get('requested_downloads') or []
            if req and isinstance(req[0], dict):
                candidate = req[0].get('filepath') or req[0].get('_filename')
                if candidate and os.path.isfile(candidate):
                    downloaded_path = candidate

        if not downloaded_path or not os.path.isfile(downloaded_path):
            vid_id = info.get('id', '')
            if vid_id:
                for name in os.listdir(output_dir):
                    if name.startswith(f'{vid_id}.'):
                        candidate = os.path.join(output_dir, name)
                        if os.path.isfile(candidate):
                            downloaded_path = candidate
                            break

        if not downloaded_path or not os.path.isfile(downloaded_path):
            raise RuntimeError('다운로드된 오디오 파일 경로를 찾을 수 없습니다.')

        print_progress('completed', 100.0, '다운로드가 완료되었습니다.')
        print(json.dumps({
            'type': 'result',
            'title': title,
            'outputPath': downloaded_path,
        }), flush=True)
    except Exception as exc:
        message = str(exc)
        print(json.dumps({'type': 'error', 'message': message}), flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
