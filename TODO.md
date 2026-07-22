# TODO: Add detailed yt-dlp error logging

## Steps

- [x] Plan created and approved
- [x] 1. `backend/ytDlp.js` — Add raw stderr logging in `runProcess()` on non-zero exit
- [x] 2. `backend/ytDlpProgress.js` — Accumulate stderr and log it on non-zero exit in `runProcessStreaming()`
- [x] 3. `backend/server.js` — Log raw stderr in `/api/info` catch block
- [x] 4. `backend/server.js` — Log raw stderr in `/api/download` catch block
- [x] 5. `backend/server.js` — Log cookies file size and first line at startup
- [x] 6. Test with a real YouTube URL to verify raw stderr output

