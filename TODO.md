    # TODO: Switch to Native Browser Download — COMPLETED

## Root Cause Analysis

### Bug 1: SSE Event Type Mismatch
- **Problem**: `progressStore.js` sent events with `event: progress\n` (named events). `EventSource.onmessage` only fires for **unnamed events** (no `event:` line). Named events require `addEventListener('progress', ...)`.
- **Fix**: Send both named AND unnamed events in the SSE stream.

### Bug 2: Premature Download Trigger (Race Condition)
- **Problem**: yt-dlp sends multiple `"finished"` progress events — one per stream (video, audio) and ffmpeg merge. The frontend was triggering the browser download on the **first** `finished` event, long before ffmpeg had merged the final file. By the time the browser's GET request arrived, the file didn't exist yet.
- **Fix**: 
  - Backend now sends `_fileReady: true` ONLY after the file is registered in `downloadFilesStore` (post-merge).
  - Frontend checks for `data._fileReady` before triggering the native browser download.

### Bug 3: Missing Debug Logging
- **Fix**: Added logging at every critical step — button click, SSE message, download URL construction, and backend file serving route.

## Changes Made

### `backend/progressStore.js`
- SSE events now send BOTH `event: progress\n` (named) AND unnamed `data: ...` events.

### `backend/server.js`
- Backend route `/api/download` now includes `_fileReady: true` in the final "finished" progress event.
- Added console.log when file is ready for serving.

### `frontend/app.js`
- Only triggers download when `data._fileReady === true` (ignores intermediate yt-dlp stream "finished" events).
- Logs the full download URL to console before navigation.
- Added `[DEBUG]` logging at button click, params, URL, and click events.

