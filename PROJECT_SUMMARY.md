# y2mp3 — Project Summary (snapshot)

Date: 2026-04-09

This document captures the current state of the repository and the work we've done so far. It's intended as a living developer summary so you can pause and resume later, or hand off to another developer and keep the conversation context.

## High-level overview

- Purpose: Desktop app to download YouTube audio and convert to MP3 using yt-dlp and ffmpeg.
- Stack: Electron (main, preload, renderer) for UI + a Python backend (`backend/download.py`) that downloads audio via yt-dlp. Conversion (ffmpeg) has been separated to keep responsibilities clear.
- IPC: Renderer ⇄ Main via contextBridge (preload.js). Main spawns the Python backend and forwards progress messages to renderer.

## Key files (current snapshot)

- `package.json` — basic project manifest (start script: `electron .`).
- `main.js` — Electron main process. Responsible for window creation, IPC handlers, spawning Python backend, parsing backend JSON-lines from stdout, forwarding sanitized progress to renderer, and a deadlock detection mechanism.
- `preload.js` — Exposes safe APIs to renderer via `window.electronAPI`:
  - `convertVideo(url, outputDir, bitrate)`
  - `selectOutputFolder()`
  - `getDefaultOutputPath()` / `setDefaultOutputPath(p)`
  - `openOutputFolder(p)`
  - `onProgress(callback)` — receives `conversion-progress` payloads
- `renderer.js` — UI glue: collects inputs (URL, bitrate, output folder), calls `convertVideo`, receives progress updates and updates the progress bar & messages. Handles select/open folder UX.
- `index.html` — Minimal UI with: URL input, bitrate select, convert button, output path input, select/open folder buttons, progress panel, and status text.
 - `backend/download.py` — Python script that uses `yt_dlp` to download the best-audio file and returns the downloaded file path to the main process. It emits JSON-lines to stdout using `print(json.dumps(...), flush=True)` with types: `progress`, `result`, `error`. It contains:
  - early URL validation
  - extractor-args parsing and retry strategy (player_client variants) for problematic videos
  - robust downloaded-file resolution and logging to `conversion.log` (in the output folder) for warnings/debug details

## IPC & progress contract

- Backend prints JSON lines with a `type` key. Example payloads:
  - `{ type: 'progress', status: 'download'|'convert'|'completed'|'info'|'error', percent: <num>, message: <str> }`
  - `{ type: 'result', title: '...', outputPath: 'C:\path\to\file.mp3' }`
  - `{ type: 'error', message: '...' }`
- `main.js` parses JSON-lines, filters noisy messages (info/warning/debug) and forwards only meaningful statuses to the renderer. Non-fatal errors are logged but not shown to users. Fatal errors or deadlocks display a user-friendly message and `fatal: true` is returned to the renderer for the `convertVideo` promise.

## How to run (development)

Prereqs:
- Node.js (>=16 recommended for this Electron version)
- Python + required packages (if you keep the Python backend) — see `backend/requirements.txt`.
- Optionally, `ffmpeg` available on PATH or placed in an expected bundled path.

Start in development:

1. Install dependencies:

```cmd
npm install
```

2. If you use the Python backend locally, create a virtualenv and install requirements:

```cmd
python -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt
```

3. Run the app:

```cmd
npm start
```

Notes:
- The main process expects the Python executable to be available as `python` on Windows or `python3` on Unix. If your environment differs, use a wrapper or adjust `main.js`.

## Packaging / Creating an executable

There are two main approaches; choose based on your distribution needs.

Option A — Recommended: Bundle yt-dlp and ffmpeg binaries and package with electron-builder

- Pros: Simplifies packaging (no Python runtime bundling), smaller integration surface, cross-platform packaging via `electron-builder`.
- Cons: You must include platform-specific binary artifacts for yt-dlp/ffmpeg; some legal/license checks may be required depending on ffmpeg build.

Steps (high-level):

1. Add `electron-builder` as a devDependency and add build config to `package.json`.
2. Prepare `resources/bin/<platform>/` with `yt-dlp` and `ffmpeg` for each target platform, or implement a runtime downloader inside `main.js` to fetch ffmpeg on first run.
3. Adjust `main.js` to call the yt-dlp binary instead of spawning Python backend (or keep Python but bundle it as native executable via PyInstaller per-platform).
4. Run `npm run dist` (configured script) on the target OS to produce installers (Windows: NSIS/exe, macOS: dmg, Linux: AppImage/deb).

Option B — Bundle Python backend (PyInstaller) inside Electron

- Pros: Keep the existing Python code almost unchanged.
- Cons: Must build Python binary with PyInstaller separately for each target OS. Process is more complex but doable for CI pipelines.

Steps (high-level):

1. For each target OS, create a PyInstaller spec to bundle the backend script (for example `backend/download.py`) + dependencies into a single executable.
2. Put the produced executable into `resources/` and update `main.js` to spawn that executable instead of invoking `python`.
3. Use `electron-builder` to produce final installers.

## Current TODOs (developer checklist)

- [ ] Add robust fallback messaging and retry/ retry UI for ffmpeg download failures.
- [ ] Perform smoke tests on Windows/macOS/Linux: ensure ffmpeg detection and conversion end-to-end.
- [ ] If you choose the runtime-download model: store validated SHA256 checksums and validate downloads before extraction.
- [ ] (Optional) Add a 'Log view' in the UI to open `conversion.log` for the last run.

## FFmpeg runtime-download (notes)

- There is experimental code in `main.js` (previous edits) that implemented `ensureFFmpeg()` to download platform-specific ffmpeg archives from community builds, extract to `app.getPath('userData')/ffmpeg/latest/` and emit `ffmpeg-download` progress events. If you want this flow enabled long-term, add SHA256 checksums for your chosen release URLs and run cross-platform tests.

## Where logs are written

- `backend/download.py` writes detailed logs to `conversion.log` inside the chosen output/download folder. UI intentionally hides noisy warnings from the user and points to that log file when fatal errors occur.

## How to continue later (developer checklist)

1. Decide packaging approach (A: yt-dlp+ffmpeg binaries + electron-builder) or (B: PyInstaller for Python backend).
2. If A: gather platform binaries and add them under `resources/bin/<platform>/` and update `main.js` to use them.
3. Add `electron-builder` config to `package.json` (I can do this for you when you confirm the preferred packaging option and target platforms).
4. Add CI (GitHub Actions) recipes for building artifacts on each platform (recommended).

## Quick commands (developer)

- Dev run: `npm start`
- Add electron-builder: `npm install --save-dev electron-builder` (then add `build` entry in package.json and `scripts: { "dist": "electron-builder" }`)
- Build on Windows: run `npm run dist` on Windows machine (or configure GitHub Actions to run windows-latest runner).

## Contact notes (why some decisions were made)

- UI hides backend warnings/errors to avoid showing noisy ffmpeg / yt-dlp text to users. Detailed logs are kept in `conversion.log`.
- There is a deadlock detector to avoid leaving conversions hanging indefinitely; only fatal conditions are surfaced to the user.

---

If you want, I can now:
- add an `electron-builder` skeleton to `package.json` and minimal `build` config, or
- implement the yt-dlp+ffmpeg binary-runner path to avoid bundling Python, or
- create simple CI workflow files to build artifacts per-platform.
Tell me which direction you prefer and I'll apply the changes and produce exact `npm` commands to build distributables.

Updates applied (snapshot):
- Added `electron-builder` skeleton to `package.json` with basic build targets (Windows NSIS, macOS dmg, Linux AppImage/deb).
- Refactored backend: the download-only script is now `backend/download.py` and returns the downloaded file path; ffmpeg-based conversion was removed from the backend to simplify responsibilities.
- Removed the runtime ffmpeg downloader from `main.js` as part of separating download vs conversion concerns; conversion should be invoked by a separate step or a conversion service that consumes the downloaded file.

Notes:
- The runtime downloader uses community builds (BtbN) as CDN examples. For production, replace with a controlled release URL and provide SHA256 checksums for verification.
- Packaging still requires running `npm install` to fetch `electron-builder` before `npm run dist`.
