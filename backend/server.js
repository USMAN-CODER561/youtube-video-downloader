const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');

const { getYtDlpPath, runDumpJson, runDownloadToFile, parseDumpJsonToInfo } = require('./ytDlp');
const { runDownloadWithProgress } = require('./ytDlpProgress');
const progressStore = require('./progressStore');
const downloadFilesStore = require('./downloadFilesStore');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const TMP_DIR = path.join(os.tmpdir(), 'yt-dlp-downloader');
fs.mkdirSync(TMP_DIR, { recursive: true });

app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false
    })
);

app.use(
    cors({
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['POST', 'GET'],
        allowedHeaders: ['Content-Type']
    })
);

app.use(bodyParser.json({ limit: '64kb' }));

// For SSE: avoid any buffering/compression layers (none used today), but disable caching
app.disable('etag');

// Serve frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function isYouTubeUrl(urlStr) {
    try {
        if (typeof urlStr !== 'string') return false;
        const s = urlStr.trim();
        if (!s) return false;
        const u = new URL(s);
        const hostname = u.hostname.replace(/^www\./, '').toLowerCase();

        // youtube.com/watch?v=VIDEO_ID (11 chars)
        if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
            if (u.pathname !== '/watch') return false;
            const id = u.searchParams.get('v');
            return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
        }

        // youtu.be/VIDEO_ID (11 chars)
        if (hostname === 'youtu.be') {
            const id = u.pathname.replace(/^\//, '');
            return /^[A-Za-z0-9_-]{11}$/.test(id);
        }

        return false;
    } catch {
        return false;
    }
}

function normalizeTitleForFilename(title, fallback, maxLen) {
    // Sanitize to ASCII-only safe filename component.
    const fb = typeof fallback === 'string' && fallback.trim() ? fallback.trim() : 'video';
    const ml = Number.isFinite(maxLen) ? maxLen : 100;

    let s = String(title == null ? fb : title).trim();

    // Remove emojis (best-effort) and some common unicode symbol ranges.
    s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ');

    // Replace invalid filename chars on Windows/macOS/Linux.
    // < > : " / \\ | ? *
    s = s.replace(/[\\/:*?"<>|]+/g, '_');

    // Convert remaining non-ASCII to spaces.
    s = s.replace(/[^\x00-\x7F]/g, ' ');

    // Collapse whitespace.
    s = s.replace(/\s+/g, ' ').trim();
    // Replace spaces with underscores to avoid weird trimming.
    s = s.replace(/\s/g, '_');

    // Final whitelist.
    s = s.replace(/[^A-Za-z0-9_.()\-]+/g, '');

    if (!s) s = fb;
    if (s.length > ml) s = s.slice(0, ml);
    s = s.trim();

    if (!s) s = fb;
    return s;
}

function encodeRFC5987ValueChars(str) {
    // RFC 5987: filename*=UTF-8''<value>
    return encodeURIComponent(String(str))
        .replace(/['()]/g, escape)
        .replace(/%20/g, '+');
}

function setContentDispositionSafe(res, { asciiFilename, utf8Filename }) {
    const safeAscii = String(asciiFilename || 'video')
        .replace(/[\r\n\u0000-\u001F\u007F]/g, '')
        .trim();

    const safeUtf8 = String(utf8Filename || safeAscii)
        .replace(/[\r\n\u0000-\u001F\u007F]/g, '')
        .trim();

    const encoded = encodeRFC5987ValueChars(safeUtf8);

    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`
    );
}

function toUserFriendlyYtDlpError(stderrOrErrText) {
    const txt = String(stderrOrErrText || '').toLowerCase();

    const has = (s) => txt.includes(s);

    if (has('private video') || has('this video is private') || has('private')) {
        return 'This video is private or restricted.';
    }
    if (has('age-restricted') || has('age restricted') || has('13+')) {
        return 'This video appears to be age-restricted.';
    }
    if (has('sign in') || has('login')) {
        return 'This video requires login.';
    }
    if (has('unavailable') || has('video unavailable')) {
        return 'This video is unavailable.';
    }
    if (has('copyright')) {
        return 'This video cannot be downloaded due to copyright restrictions.';
    }
    if (has('network')) {
        return 'Network error while contacting YouTube. Try again.';
    }
    if (has('timed out') || has('timeout')) {
        return 'Request timed out while contacting YouTube. Try again.';
    }

    if (txt.trim().length) return 'Download failed. ' + String(stderrOrErrText).slice(0, 2000);
    return 'Download failed. Please try another link.';
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.post('/api/info', async(req, res) => {
    try {
        const body = req.body || {};
        const url = typeof body.url === 'string' ? body.url.trim() : '';

        if (!url || !isYouTubeUrl(url)) {
            return res.status(400).json({ ok: false, error: 'Invalid URL. Paste a valid YouTube URL (youtube.com or youtu.be).' });
        }

        const raw = await runDumpJson(url);
        const parsed = parseDumpJsonToInfo(raw);

        return res.json({ ok: true, video: parsed });
    } catch (err) {
        const friendly = toUserFriendlyYtDlpError(err && (err.stderr || err.message || err));
        const statusCode = err && err.statusCode ? err.statusCode : 500;
        return res.status(statusCode).json({ ok: false, error: friendly });
    }
});

// SSE endpoint for progress
app.get('/api/progress/:jobId', (req, res) => {
    const jobId = String(req.params.jobId || '');

    const job = progressStore.getJob(jobId);
    if (!job) {
        res.status(404).end();
        return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    // IMPORTANT: flush headers immediately for SSE
    res.flushHeaders && res.flushHeaders();

    // Send an initial event + keep streaming for this client
    progressStore.addSseClient(jobId, res);
});

app.post('/api/download', async(req, res) => {
    const body = req.body || {};
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const format_id = typeof body.format_id === 'string' ? body.format_id : '';

    if (!url || !isYouTubeUrl(url)) {
        return res.status(400).json({ ok: false, error: 'Invalid URL.' });
    }
    if (!format_id) {
        return res.status(400).json({ ok: false, error: 'Missing format_id.' });
    }

    const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const workDir = path.join(TMP_DIR, jobId);
    fs.mkdirSync(workDir, { recursive: true });

    // initialize job for SSE
    progressStore.createJob(jobId);

    // Fetch title for naming.
    const raw = await runDumpJson(url);
    const parsed = parseDumpJsonToInfo(raw);

    const originalTitle = parsed.title || 'download';
    const asciiBase = normalizeTitleForFilename(originalTitle, 'video', 100);

    // We must pass an output pattern to yt-dlp progress runner.
    const outPattern = path.join(workDir, `${asciiBase}.%(ext)s`);

    // Start download in background and return immediately.
    (async() => {
        try {
            console.log('[job] start', { jobId, format_id });

            await runDownloadWithProgress({
                url,
                formatId: format_id,
                outPattern,
                ffmpegPath: process.env.FFMPEG_PATH || '',
                onProgress: (p) => {
                    // Ensure we always update something so the UI progress bar moves.
                    const normalized = {
                        status: p && p.status ? p.status : 'downloading',
                        percent: typeof p.percent === 'number' ? p.percent : 0,
                        downloaded_bytes: p && p.downloaded_bytes,
                        total_bytes: p && p.total_bytes,
                        speed: p && p.speed,
                        eta_seconds: p && p.eta_seconds,
                    };
                    progressStore.setJobProgress(jobId, normalized);
                }
            });

            // Find produced file and store it for /api/download/file/:jobId
            const workFiles = fs.readdirSync(workDir);
            // outPattern is `${asciiBase}.%(ext)s` so files start with `${asciiBase}.`
            const candidates = workFiles
                .filter((fn) => fn.startsWith(`${asciiBase}.`))
                .map((fn) => ({
                    fn,
                    fp: path.join(workDir, fn)
                }));

            if (!candidates.length) {
                throw new Error(`yt-dlp produced no files for job ${jobId} in ${workDir}`);
            }

            candidates.sort((a, b) => fs.statSync(b.fp).mtimeMs - fs.statSync(a.fp).mtimeMs);
            const filePath = candidates[0].fp;
            const ext = (path.extname(filePath).replace('.', '').toLowerCase() || 'mp4');

            const mimeType = ext === 'mp3' ? 'audio/mpeg' : ext === 'mp4' ? 'video/mp4' : 'application/octet-stream';

            downloadFilesStore.setJobFile(jobId, {
                filePath,
                mimeType,
                ext,
                asciiFilename: `${asciiBase}.${ext}`
            });

            console.log('[job] file ready for serving', { jobId, filePath, asciiFilename: `${asciiBase}.${ext}` });

            progressStore.setJobProgress(jobId, {
                status: 'finished',
                percent: 100,
                _fileReady: true // CRITICAL: distinguishes from yt-dlp's intermediate stream "finished" events
            });
        } catch (err) {
            console.log('[job] failed', jobId, err && (err.message || err));
            progressStore.setJobProgress(jobId, { status: 'error', percent: 0 });
        }
    })();

    res.json({ ok: true, jobId });
});

app.get('/api/download/file/:jobId', (req, res) => {
    const jobId = String(req.params.jobId || '');
    const jobFile = downloadFilesStore.getJobFile(jobId);

    if (!jobFile) {
        return res.status(404).send('File not found or job expired.');
    }

    const { filePath, mimeType, asciiFilename } = jobFile;

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found on disk.');
    }

    // Set headers and send file
    res.setHeader('Content-Type', mimeType);
    setContentDispositionSafe(res, { asciiFilename, utf8Filename: asciiFilename });

    // Stream the file and delete it after sending to avoid filling disk
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

    res.on('finish', () => {
        try {
            // Clean up files and directories
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            const dir = path.dirname(filePath);
            if (fs.existsSync(dir)) {
                fs.rmdirSync(dir);
            }
        } catch (e) {
            console.error('[server] error during file cleanup:', e);
        }
        downloadFilesStore.deleteJobFile(jobId);
        progressStore.deleteJob(jobId);
    });
});

// ──────────────────────────────────────────────
//  Startup health check
// ──────────────────────────────────────────────
async function checkDependencies() {
    const ytDlpPath = getYtDlpPath();
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

    let ytDlpOk = false;
    let ffmpegOk = false;

    try {
        const ytOut = await new Promise((resolve, reject) => {
            const child = spawn(ytDlpPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '';
            child.stdout.on('data', (chunk) => { out += chunk; });
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) resolve(out.trim());
                else reject(new Error(`exit code ${code}`));
            });
        });
        console.log(`[startup] yt-dlp OK — ${ytDlpPath} (v${ytOut})`);
        ytDlpOk = true;
    } catch (err) {
        console.error(`[startup] FAILED — yt-dlp not found at "${ytDlpPath}". ${err.message}`);
        console.error('[startup] Download yt-dlp and set YTDLP_PATH, or run ./build.sh');
    }

    try {
        const ffOut = await new Promise((resolve, reject) => {
            const child = spawn(ffmpegPath, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '';
            child.stdout.on('data', (chunk) => { out += chunk; });
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) resolve(out.split('\n')[0]);
                else reject(new Error(`exit code ${code}`));
            });
        });
        console.log(`[startup] ffmpeg OK — ${ffOut}`);
        ffmpegOk = true;
    } catch (err) {
        console.error(`[startup] FAILED — ffmpeg not found at "${ffmpegPath}". ${err.message}`);
        console.error('[startup] Install ffmpeg and set FFMPEG_PATH, or run ./build.sh');
    }

    if (!ytDlpOk || !ffmpegOk) {
        console.warn('[startup] WARNING: One or more dependencies are missing. Downloads will fail until this is resolved.');
    }
}

app.listen(PORT, async() => {
    console.log(`yt-dlp downloader running at http://localhost:${PORT}`);
    await checkDependencies();
});