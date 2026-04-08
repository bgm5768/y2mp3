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
    parser = argparse.ArgumentParser(description='Convert YouTube video to MP3 using yt-dlp.')
    parser.add_argument('--url', required=True, help='YouTube video URL')
    parser.add_argument('--output', required=True, help='Output directory for MP3 files')
    parser.add_argument('--cookies', help='Path to cookies.txt to pass to yt-dlp', default=None)
    parser.add_argument('--extractor-args', help='Extractor args (JSON or simple form like "youtube:player_client=android,web")', default=None)
    parser.add_argument('--bitrate', help='MP3 bitrate (e.g. 64k, 128k, 192k, 320k)', default='192k')
    parser.add_argument('--interp', type=float, default=0.6, help='Interpolation factor for smoothing ffmpeg percent (0..1)')
    parser.add_argument('--anim-early', type=float, default=1.0, help='Animator step for early stage (percent increment)')
    parser.add_argument('--anim-mid', type=float, default=0.4, help='Animator step for mid stage (percent increment)')
    parser.add_argument('--anim-late', type=float, default=0.15, help='Animator step for late stage (percent increment)')
    args = parser.parse_args()

    url = args.url.strip()
    output_dir = os.path.abspath(args.output)
    os.makedirs(output_dir, exist_ok=True)

    bitrate = str(args.bitrate).strip().lower()
    if not re.fullmatch(r'\d+k', bitrate):
        bitrate = '192k'

    # logfile for ongoing messages and errors
    log_path = os.path.join(output_dir, 'conversion.log')

    def log_message(level: str, msg: str):
        try:
            with open(log_path, 'a', encoding='utf-8') as f:
                from datetime import datetime, timezone

                # use timezone-aware UTC datetime to avoid deprecation warnings
                ts = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S %Z')
                f.write(f"[{ts}] {level.upper()}: {msg}\n")
        except Exception:
            # logging should never crash conversion
            pass

    def extract_video_id_from_url(u: str):
        """Try to recover a YouTube video id from several common forms.

        Returns the 11-character id if found, otherwise None.
        """
        # watch?v=..., youtu.be/..., or raw id
        m = re.search(r'(?:v=|youtu\.be/|youtube\.com/watch\?v=)([A-Za-z0-9_-]{11})', u)
        if m:
            return m.group(1)
        if re.fullmatch(r'[A-Za-z0-9_-]{11}', u):
            return u
        return None

    # Validate the provided URL / id early so we give a friendlier error than
    # yt-dlp's "Incomplete YouTube ID" when callers accidentally pass a
    # truncated value or placeholder (for example "XXXX").
    vid = extract_video_id_from_url(url)
    if not vid:
        err_msg = (
            f"잘못된 또는 잘라진 YouTube URL/ID입니다: {url}.\n"
            "전체 watch URL(예: https://www.youtube.com/watch?v=VIDEO_ID) 또는 유효한 11자의 비디오 ID를 제공하세요."
        )
        # log and emit an immediate JSON error so the UI/main process sees it
        try:
            log_message('error', err_msg)
        except Exception:
            pass
        print(json.dumps({'type': 'error', 'message': err_msg}), flush=True)
        sys.exit(1)

    def parse_extractor_args(s: str):
        """Parse extractor args from either JSON or a short form.

        Short form example: "youtube:player_client=android,web;another:opt=val"
        Returns a dict suitable for ydl_opts['extractor_args'] or None.
        """
        if not s:
            return None
        s = s.strip()
        # try JSON first
        try:
            obj = json.loads(s)
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass

        result = {}
        # allow semicolon-separated entries
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
        """Normalize extractor args for yt-dlp API usage.

        yt-dlp CLI accepts comma-separated strings for some args, but Python API
        prefers list values for args such as youtube.player_client.
        """
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
            # log and emit immediate error progress so UI sees it
            log_message('error', str(msg))
            try:
                print_progress('error', 0.0, str(msg), extra={'log_path': log_path})
            except Exception:
                pass

    def find_ffmpeg_path():
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        candidates = []
        if sys.platform.startswith('win'):
            candidates.extend([
                os.path.join(root_dir, 'ffmpeg', 'ffmpeg.exe'),
                os.path.join(root_dir, 'ffmpeg.exe'),
            ])
        else:
            candidates.extend([
                os.path.join(root_dir, 'ffmpeg', 'ffmpeg'),
                os.path.join(root_dir, 'ffmpeg'),
            ])
        for path in candidates:
            if os.path.isfile(path):
                return path
        return None

    local_ffmpeg = find_ffmpeg_path()
    if local_ffmpeg:
        print_progress('info', 0, f'내장 FFmpeg 사용: {local_ffmpeg}')

    # tuning parameters (can be configured via CLI args)
    INTERP = max(0.0, min(1.0, float(args.interp)))
    ANIM_EARLY = float(args.anim_early)
    ANIM_MID = float(args.anim_mid)
    ANIM_LATE = float(args.anim_late)

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
            print_progress('download', 100.0, '다운로드가 완료되었습니다. MP3 변환을 준비 중...')
            log_message('info', '다운로드 완료')
        elif d.get('status') == 'error':
            # yt-dlp may report error states to progress hook; capture and log
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

    if local_ffmpeg:
        ydl_opts['ffmpeg_location'] = local_ffmpeg
    # cookies support
    if args.cookies:
        cookie_path = os.path.abspath(args.cookies)
        # yt-dlp uses 'cookiefile' option
        ydl_opts['cookiefile'] = cookie_path
        log_message('info', f'쿠키 파일 사용: {cookie_path}')

    # extractor args support (parsed from CLI)
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

        # Resolve downloaded input path safely (without relying on YoutubeDL instance).
        downloaded_path = info.get('_filename')
        if not downloaded_path or not os.path.isfile(downloaded_path):
            req = info.get('requested_downloads') or []
            if req and isinstance(req[0], dict):
                candidate = req[0].get('filepath') or req[0].get('_filename')
                if candidate and os.path.isfile(candidate):
                    downloaded_path = candidate

        if not downloaded_path or not os.path.isfile(downloaded_path):
            # Fallback: locate by id prefix in output directory
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

        output_path = os.path.join(output_dir, f"{safe_title}.mp3")

        ffmpeg_cmd = local_ffmpeg if local_ffmpeg else 'ffmpeg'
        duration_ms = int(float(info.get('duration', 0)) * 1000)
        ffmpeg_args = [
            ffmpeg_cmd,
            '-y',
            '-i', downloaded_path,
            '-vn',
            '-acodec', 'libmp3lame',
            '-b:a', bitrate,
            output_path,
            '-progress', 'pipe:1',
            '-nostats',
        ]

        print_progress('convert', 0.0, 'MP3 변환을 시작합니다...')
        last_percent = 0.0
        ffmpeg_completed = False
        conversion_stop = threading.Event()
        lock = threading.Lock()

        def parse_time_to_ms(time_str: str) -> int:
            parts = time_str.split(':')
            if len(parts) != 3:
                return 0
            try:
                hours = int(parts[0])
                minutes = int(parts[1])
                seconds = float(parts[2])
            except ValueError:
                return 0
            return int((hours * 3600 + minutes * 60 + seconds) * 1000)

        last_ffmpeg_line = ''

        def handle_progress_line(raw_line):
            """Parse ffmpeg -progress lines and emit smoothed percent updates.

            We avoid aggressive jumps. When ffmpeg provides time info we
            interpolate toward that percent using INTERP.
            """
            nonlocal last_percent, ffmpeg_completed, last_ffmpeg_line
            line = raw_line.strip()
            if not line:
                return
            # remember last ffmpeg output line (short)
            last_ffmpeg_line = line[:200]
            try:
                if line.startswith('out_time_ms=') and duration_ms > 0:
                    out_ms = int(line.split('=', 1)[1])
                    raw_percent = max(0.0, min(100.0, (out_ms / duration_ms) * 100.0))
                    with lock:
                        if raw_percent > last_percent:
                            interp = last_percent + (raw_percent - last_percent) * INTERP
                            interp = round(min(100.0, interp), 1)
                            if interp > last_percent:
                                last_percent = interp
                                print_progress('convert', last_percent, f"MP3 변환 중... {last_percent}%")
                elif line.startswith('time=') and duration_ms > 0:
                    time_ms = parse_time_to_ms(line.split('=', 1)[1])
                    if time_ms > 0:
                        raw_percent = max(0.0, min(100.0, (time_ms / duration_ms) * 100.0))
                        with lock:
                            if raw_percent > last_percent:
                                interp = last_percent + (raw_percent - last_percent) * INTERP
                                interp = round(min(100.0, interp), 1)
                                if interp > last_percent:
                                    last_percent = interp
                                    print_progress('convert', last_percent, f"MP3 변환 중... {last_percent}%")
                elif line.startswith('progress=continue'):
                    # ffmpeg signals it's still working; update internal percent
                    # but do NOT emit UI progress for these 'continue' signals
                    with lock:
                        if last_percent < 70.0:
                            last_percent = round(min(70.0, last_percent + max(1.0, ANIM_EARLY)), 1)
                            log_message('debug', f"ffmpeg: progress=continue -> internal percent bumped to {last_percent}")
                        else:
                            last_percent = round(min(98.0, last_percent + 1.0), 1)
                            log_message('debug', f"ffmpeg: progress=continue -> internal percent bumped to {last_percent}")
                elif line.startswith('progress=end'):
                    with lock:
                        last_percent = 100.0
                        ffmpeg_completed = True
                        print_progress('convert', 100.0, 'MP3 변환이 완료되었습니다.')
            except Exception:
                return

        def read_stream(stream):
            for raw_line in iter(stream.readline, ''):
                handle_progress_line(raw_line)

        def animate_conversion():
            nonlocal last_percent
            # Gentle, non-linear animator to make the conversion feel active
            while not conversion_stop.is_set():
                with lock:
                    if last_percent < 60.0:
                        # Early: advance reasonably quickly
                        step = 1.0
                    elif last_percent < 90.0:
                        # Mid: slow down
                        step = 0.4
                    else:
                        # Late: very slow approach to near-completion
                        step = 0.15

                    if last_percent < 98.0:
                        last_percent = round(min(98.0, last_percent + step), 1)
                        print_progress('convert', last_percent, f"MP3 변환 중... {last_percent}%")
                conversion_stop.wait(0.5)

        # Ensure we decode ffmpeg output as UTF-8 and replace any invalid bytes to avoid
        # UnicodeDecodeError on Windows consoles using legacy encodings.
        with subprocess.Popen(ffmpeg_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', bufsize=1) as proc:
            animator = threading.Thread(target=animate_conversion)
            animator.daemon = True
            animator.start()
            threads = []
            for stream in (proc.stdout, proc.stderr):
                t = threading.Thread(target=read_stream, args=(stream,))
                t.daemon = True
                t.start()
                threads.append(t)
            proc.wait()
            conversion_stop.set()
            animator.join(timeout=1)
            for t in threads:
                t.join(timeout=1)
            if proc.returncode != 0:
                stderr = proc.stderr.read().strip()
                raise RuntimeError(f'FFmpeg 변환 실패: {stderr}')
            if proc.returncode == 0 and not ffmpeg_completed:
                print_progress('convert', 100.0, 'MP3 변환이 완료되었습니다.')

        if os.path.isfile(downloaded_path) and downloaded_path != output_path:
            try:
                os.remove(downloaded_path)
            except OSError:
                pass

        print_progress('completed', 100.0, 'MP3 변환이 완료되었습니다.')
        print(json.dumps({
            'type': 'result',
            'title': title,
            'outputPath': output_path,
        }), flush=True)
    except Exception as exc:
        message = str(exc)
        print(json.dumps({'type': 'error', 'message': message}), flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
