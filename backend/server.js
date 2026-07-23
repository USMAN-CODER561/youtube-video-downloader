const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');

const { getYtDlpPath, getFfmpegPath, getCookiesPath, getSourceCookiesPath, getDenoPath, initCookiesCopy, setCookiesEnabled, runDumpJson, runDownloadToFile, parseDumpJsonToInfo } = require('./ytDlp');
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

    // Cookie/bot detection — distinct from other errors
    if (has('sign in to confirm') || has('sign in') || has('login') || has('bot') || has('cookie')) {
        // This is a service-level authentication issue, not a user error
        return 'This service is temporarily unavailable for downloads, please try again later.';
    }

    if (has('private video') || has('this video is private') || has('private')) {
        return 'This video is private or restricted.';
    }
    if (has('age-restricted') || has('age restricted') || has('13+')) {
        return 'This video appears to be age-restricted.';
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

// Known small public YouTube video ID used for cookie health checks
const COOKIE_TEST_VIDEO_ID = 'dQw4w9WgXcQ'; // Rick Astley - Never Gonna Give You Up (public, short)
let lastCookieValidationTimestamp = null;
let cookieValidationResult = null; // { ok: boolean, checkedAt: ISO string }

/**
 * Run a lightweight yt-dlp test against a known public video to check if cookies are valid.
 * Uses --socket-timeout 10 and --extractor-args youtube:player_client=tv,ios for fast results.
 * If cookies are missing or the check fails, cookies are disabled server-wide.
 * The server always continues running regardless of cookie status.
 * Returns { ok, checkedAt, message }.
 */
async function checkCookieHealth() {
    const testUrl = `https://www.youtube.com/watch?v=${COOKIE_TEST_VIDEO_ID}`;
    const checkedAt = new Date().toISOString();
    try {
        // Spawn yt-dlp directly with TV/iOS extractor + socket timeout
        const ytDlpCmd = getYtDlpPath();
        const cookiesPath = getCookiesPath();
        const args = [
            '--dump-json',
            '--no-playlist',
            '--socket-timeout', '10',
            '--extractor-args', 'youtube:player_client=tv,ios',
            '--no-warnings',
        ];

        // Include --cookies only if a cookies file exists
        if (cookiesPath) {
            args.push('--cookies', cookiesPath);
        } else {
            // No cookies file at all - disable cookies silently
            setCookiesEnabled(false);
            cookieValidationResult = { ok: false, checkedAt, message: 'No cookies file found - using TV/iOS clients' };
            console.log('[startup][cookies] No cookies file found - cookies disabled, falling back to TV/iOS clients');
            return cookieValidationResult;
        }
        args.push(testUrl);

        const { stdout } = await new Promise((resolve, reject) => {
            const child = spawn(ytDlpCmd, args, { windowsHide: true });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
            child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
            const timeout = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch {}
                const err = new Error('yt-dlp timed out');
                err.stderr = stderr;
                reject(err);
            }, 15000);
            child.on('error', (err) => { clearTimeout(timeout);
                reject(err); });
            child.on('close', (code) => {
                clearTimeout(timeout);
                if (code === 0) resolve({ stdout, stderr });
                else {
                    const err = new Error(`yt-dlp exited with code ${code}`);
                    err.stderr = stderr;
                    err.stdout = stdout;
                    reject(err);
                }
            });
        });

        // If we got JSON back without sign-in error, cookies are valid
        if (stdout && String(stdout).trim().startsWith('{')) {
            cookieValidationResult = { ok: true, checkedAt };
            return cookieValidationResult;
        }

        // Non-JSON output means something went wrong even with cookies
        setCookiesEnabled(false);
        cookieValidationResult = { ok: false, checkedAt, message: 'Cookie test returned non-JSON output - disabling cookies' };
        return cookieValidationResult;
    } catch (err) {
        // Cookies failed - disable them and continue running
        setCookiesEnabled(false);
        cookieValidationResult = { ok: false, checkedAt, message: 'Cookie validation failed - cookies disabled, falling back to TV/iOS clients' };
        console.warn('[startup][cookies] Cookie check failed:', (err.message || err.stderr || '').slice(0, 200));
        return cookieValidationResult;
    }
}

/**
 * GET /api/cookie-status
 * Lightweight admin endpoint — calls checkCookieHealth() and returns the result.
 * The result is cached briefly (last result reused if < 60s old) to avoid hammering YouTube.
 */
app.get('/api/cookie-status', async(_req, res) => {
    // Reuse cached result if checked within the last 60 seconds
    if (cookieValidationResult && cookieValidationResult.checkedAt) {
        const ageMs = Date.now() - new Date(cookieValidationResult.checkedAt).getTime();
        if (ageMs < 60000) {
            return res.json(cookieValidationResult);
        }
    }
    const result = await checkCookieHealth();
    return res.json(result);
});

app.post('/api/info', async(req, res) => {
    // Enforce a hard 15-second ceiling for the entire info request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, 15000);

    try {
        const body = req.body || {};
        const url = typeof body.url === 'string' ? body.url.trim() : '';

        if (!url || !isYouTubeUrl(url)) {
            clearTimeout(timeoutId);
            return res.status(400).json({ ok: false, error: 'Invalid URL. Paste a valid YouTube URL (youtube.com or youtu.be).' });
        }

        const raw = await runDumpJson(url);
        const parsed = parseDumpJsonToInfo(raw);

        clearTimeout(timeoutId);
        return res.json({ ok: true, video: parsed });
    } catch (err) {
        clearTimeout(timeoutId);

        // Detect abort/timeout signals
        if (controller.signal.aborted || (err && (err.code === 'ETIMEDOUT' || err.message === 'yt-dlp timed out' || err.toString().includes('timed out') || err.toString().includes('AbortError')))) {
            console.error('[yt-dlp][api/info][timeout] Request timed out after 15s for url:', req.body && req.body.url);
            return res.status(504).json({ ok: false, error: 'Request timed out, YouTube is taking too long to respond.' });
        }

        console.error('[yt-dlp][api/info][raw-stderr]', err && (err.stderr || err.message || err));
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
                ffmpegPath: getFfmpegPath(),
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
                _fileReady: true
            });
        } catch (err) {
            console.error('[yt-dlp][api/download][raw-stderr]', err && (err.stderr || err.message || err));
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

// --- Feedback endpoint ---
const FEEDBACK_LOG = path.join(__dirname, 'feedback.log');

app.post('/api/feedback', (req, res) => {
    const body = req.body || {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const url = typeof body.url === 'string' ? body.url.trim() : '';

    if (!text) {
        return res.status(400).json({ ok: false, error: 'Missing feedback text.' });
    }

    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${text}${url ? ' | URL: ' + url : ''}\n`;

    console.log('[feedback]', logLine.trim());

    try {
        fs.appendFileSync(FEEDBACK_LOG, logLine, 'utf8');
    } catch (e) {
        console.error('[feedback] Failed to write to log file:', e.message);
    }

    return res.json({ ok: true });
});

// Startup health check
async function checkDependencies() {
    const ytDlpPath = getYtDlpPath();
    const ffmpegPath = getFfmpegPath();

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
                else reject(new Error('exit code ' + code));
            });
        });
        console.log('[startup] yt-dlp OK - ' + ytDlpPath + ' (v' + ytOut + ')');
        ytDlpOk = true;
    } catch (err) {
        console.error('[startup] FAILED - yt-dlp not found at "' + ytDlpPath + '". ' + err.message);
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
                else reject(new Error('exit code ' + code));
            });
        });
        console.log('[startup] ffmpeg OK - ' + ffOut);
        ffmpegOk = true;
    } catch (err) {
        console.error('[startup] FAILED - ffmpeg not found at "' + ffmpegPath + '". ' + err.message);
        console.error('[startup] Install ffmpeg and set FFMPEG_PATH, or run ./build.sh');
    }

    if (!ytDlpOk || !ffmpegOk) {
        console.warn('[startup] WARNING: One or more dependencies are missing. Downloads will fail until this is resolved.');
    }

    // Check Deno (JavaScript runtime for YouTube signature solving)
    const denoPath = getDenoPath();
    if (denoPath) {
        try {
            const denoOut = await new Promise((resolve, reject) => {
                const child = spawn(denoPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
                let out = '';
                child.stdout.on('data', (chunk) => { out += chunk; });
                child.on('error', reject);
                child.on('close', (code) => {
                    if (code === 0) resolve(out.split('\n')[0].trim());
                    else reject(new Error('exit code ' + code));
                });
            });
            console.log('[startup] Deno OK - ' + denoPath + ' (' + denoOut + ')');
        } catch (err) {
            console.warn('[startup] Deno found at "' + denoPath + '" but failed to run: ' + err.message);
        }
    } else {
        console.warn('[startup] Deno NOT FOUND - YouTube signature solving disabled. Some formats may be missing.');
        console.warn('[startup] Install Deno via ./build.sh or set YTDLP_DENO_PATH');
    }

    const writableCookiesPath = initCookiesCopy();

    const cookiesPath = getCookiesPath();
    if (cookiesPath) {
        const sourcePath = getSourceCookiesPath();
        console.log('[startup] Cookies source (read-only):', sourcePath);
        console.log('[startup] Cookies writable copy:', writableCookiesPath || '(copy failed, using source directly)');
        console.log('[startup] Cookies active path:', cookiesPath);
        try {
            const cookiesStat = fs.statSync(cookiesPath);
            console.log('[startup] Cookies file size:', cookiesStat.size, 'bytes');
            const cookiesContent = fs.readFileSync(cookiesPath, 'utf8');
            const firstLine = cookiesContent.split(/\r?\n/)[0] || '(empty file)';
            console.log('[startup] Cookies file first line:', firstLine);
        } catch (e) {
            console.error('[startup] Could not read cookies file details:', e.message);
        }
    } else {
        console.warn('[startup] No cookies file found - some videos may show "login required" errors');
        console.warn('[startup] Export YouTube cookies as cookies.txt and set YTDLP_COOKIES_PATH or place at /etc/secrets/cookies.txt');
    }
}

app.listen(PORT, async() => {
    console.log('yt-dlp downloader running at http://localhost:' + PORT);
    await checkDependencies();
    // Initial cookie validation test — logs result so we can track cookie lifetime
    // Does NOT crash the server if cookies fail — server continues with TV/iOS fallback.
    try {
        const health = await checkCookieHealth();
        if (health.ok) {
            console.log('[startup][cookies] Cookies VALID at ' + health.checkedAt + ' - testing video ' + COOKIE_TEST_VIDEO_ID);
        } else {
            console.warn('[startup][cookies] Cookies INVALID at ' + health.checkedAt + ' - ' + (health.message || 'unknown error'));
            console.warn('[startup][cookies] Warning: Cookies disabled, falling back to TV/iOS clients');
        }
    } catch (e) {
        // Safety net — checkCookieHealth now handles all errors internally
        console.warn('[startup][cookies] Cookie health check threw:', e.message);
        console.warn('[startup][cookies] Warning: Cookies disabled, falling back to TV/iOS clients');
    }
});