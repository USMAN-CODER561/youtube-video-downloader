# Timeout Fix Plan

## Completed Steps

- [x] 1. `backend/ytDlp.js` — `--socket-timeout` 15→45s, `runDumpJson` timeoutMs 25000→60000
- [x] 2. `backend/server.js` — `/api/info` AbortController 15000→45000ms
- [x] 3. `backend/ytDlpProgress.js` — `--socket-timeout` 5→45s, `runProcessStreaming` default timeoutMs 10000→60000
- [x] 4. `frontend/app.js` — `fetchInfo()` AbortController 15000→45000ms, download POST AbortController 15000→45000ms, update loading text with "up to 30s" messaging
- [x] 5. `frontend/index.html` — update fetch state text to show expected wait time
- [x] 6. `backend/ytDlp.js` — `runDownloadToFile` timeoutMs 30000→60000
- [x] 7. `backend/server.js` — stale log message "15s" → "45s"

