# yt-dlp Downloader (Full-Stack)

Downloads YouTube videos using **yt-dlp** (NOT youtube-dl).

## 1) Requirements
- **Node.js** (v18+ recommended)
- **yt-dlp** must be installed as a system binary: `yt-dlp`

### Install yt-dlp (Windows)
If you have Python:
```bat
py -m pip install --upgrade pip
py -m pip install yt-dlp
```
Then verify:
```bat
yt-dlp --version
```

If `yt-dlp` is not found, ensure your Python Scripts folder is on PATH (pip typically installs `yt-dlp.exe`).

## 2) Install and run
```bat
cd yt-dlp-downloader
npm install
npm start
```

## 3) Health check
After you run `npm start`, open:
- http://localhost:3000/healthz

You should see:
- { "ok": true }

## 4) Open the app
Open:
- http://localhost:3000

## 5) How it works
- `POST /api/info` runs:
  - `yt-dlp --dump-json --no-playlist <url>`
- `POST /api/download` runs:
  - `yt-dlp -f <format_id> --no-playlist -o <temp-dir>/name.%(ext)s <url>`
- The backend streams the produced file back and then deletes temp files.

## Notes / Limitations
- Some videos may be age-restricted / private / unavailable; errors are shown to the user.
- Progress parsing is limited because we stream the resulting file back immediately.

