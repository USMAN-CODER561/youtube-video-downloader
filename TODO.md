# TODO: Install Deno JS runtime + startup check + yt-dlp flag integration

## Steps

- [x] Plan created and approved
- [x] 1. `build.sh` — Add Deno binary download (Linux x86_64 zip from GitHub releases) into `./bin/deno`
- [x] 2. `backend/ytDlp.js` — Add `getDenoPath()` and `getJsRuntimeArgs()` functions; update `runDumpJson` and `runDownloadToFile` to auto-include `--js-runtimes` via `getJsRuntimeArgs()`
- [x] 3. `backend/ytDlpProgress.js` — Import `getJsRuntimeArgs` and add to `buildArgsForProgress()` common args
- [x] 4. `backend/server.js` — Add Deno version check at startup in `checkDependencies()`

