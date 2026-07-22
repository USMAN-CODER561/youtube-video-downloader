# TODO: yt-dlp Downloader Deployment Fixes

## Files Updated

### Backend
- [x] `backend/ytDlp.js` — Added `getYtDlpPath()` function that checks `YTDLP_PATH` env var, then `./bin/yt-dlp`, then falls back to `'yt-dlp'`. Exported `getYtDlpPath`. Updated `runDumpJson` and `runDownloadToFile` to use `getYtDlpPath()`.
- [x] `backend/ytDlpProgress.js` — Added `const { getYtDlpPath } = require('./ytDlp')`, updated `runDownloadWithProgress` to use `getYtDlpPath()`.
- [x] `backend/server.js` — Added `const { spawn } = require('child_process')` and `getYtDlpPath` import. Added `checkDependencies()` async function that verifies yt-dlp + ffmpeg at startup with clear logging. Updated `app.listen()` to call it.

### Build & Config
- [x] `build.sh` — Downloads yt-dlp binary to `./bin/yt-dlp`, installs ffmpeg static binary.
- [x] `render.yaml` — Render deployment config (build command: `./build.sh`, start command: `node backend/server.js`).
- [x] `.gitignore` — Ignores `node_modules/`, `bin/`, `.env`.

- [x] `package.json` — Added `build` script, `postinstall` hint.

