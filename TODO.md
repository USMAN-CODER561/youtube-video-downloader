# Timeout Fix Plan — COMPLETED ✅

## Changes Made

| Layer | File | Old Value | New Value |
|-------|------|:---------:|:---------:|
| yt-dlp `--socket-timeout` (info fetch) | `backend/ytDlp.js` (runDumpJson) | 15s | **45s** |
| Node.js wrapper timeout (info fetch) | `backend/ytDlp.js` (runDumpJson) | 25s | **60s** |
| yt-dlp `--socket-timeout` (download) | `backend/ytDlp.js` (runDownloadToFile) | 15s | **45s** |
| Backend `/api/info` AbortController | `backend/server.js` | 15s | **45s** |
| yt-dlp `--socket-timeout` (progress download) | `backend/ytDlpProgress.js` | **5s** | **45s** |
| `runProcessStreaming` default timeout | `backend/ytDlpProgress.js` | **10s** | **60s** |
| Frontend `fetchInfo()` AbortController | `frontend/app.js` | 15s | **45s** |
| Frontend download POST AbortController | `frontend/app.js` | 15s | **45s** |
| Fetch state text (user-facing) | `frontend/app.js` | "Fetching video info…" | "… (may take up to 30s on first load)" |
| Download preparing text | `frontend/app.js` | "Preparing…" | "… (may take up to 30s on first load)" |

