# Timeout Fix Plan

## ✅ All Changes Complete

| Layer | File | Change | Old | New |
|-------|------|--------|-----|-----|
| yt-dlp `--socket-timeout` (info fetch) | `backend/ytDlp.js` — `runDumpJson` | 15s → 45s | 15 | 45 |
| `runDumpJson` wrapper timeout | `backend/ytDlp.js` — `runDumpJson` | 25000ms → 60000ms | 25000 | 60000 |
| yt-dlp `--socket-timeout` (download) | `backend/ytDlp.js` — `runDownloadToFile` | 15s → 45s | 15 | 45 |
| `runDownloadToFile` wrapper timeout | `backend/ytDlp.js` — `runDownloadToFile` | 30000ms → 60000ms | 30000 | 60000 |
| Backend `/api/info` AbortController | `backend/server.js` | 15000ms → 45000ms | 15000 | 45000 |
| Backend timeout log message | `backend/server.js` | 15s → 45s | 15s | 45s |
| yt-dlp `--socket-timeout` (progress) | `backend/ytDlpProgress.js` — `buildArgsForProgress` | 5s → 45s | 5 | 45 |
| `runProcessStreaming` default timeout | `backend/ytDlpProgress.js` | 10000ms → 60000ms | 10000 | 60000 |
| Frontend `fetchInfo()` AbortController | `frontend/app.js` | 15000ms → 45000ms | 15000 | 45000 |
| Frontend download POST AbortController | `frontend/app.js` | 15000ms → 45000ms | 15000 | 45000 |
| Frontend fetch state text | `frontend/app.js` — `handleFetchVideo` | plain text | — | "…(may take up to 30s on first load)" |
| Frontend progress sub text | `frontend/app.js` — download handler | "Preparing…" | — | "Preparing… (may take up to 30s on first load)" |

