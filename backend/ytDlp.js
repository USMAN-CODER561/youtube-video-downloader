const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WRITABLE_COOKIES_DIR = path.join(os.tmpdir(), 'yt-dlp-downloader-cookies');
const WRITABLE_COOKIES_FILE = path.join(WRITABLE_COOKIES_DIR, 'cookies.txt');
let _writableCookiesPath = null;

/**
 * Returns the absolute path to the yt-dlp binary.
 * Priority: YTDLP_PATH env var → ./bin/yt-dlp (project-local) → 'yt-dlp' (PATH)
 */
function getYtDlpPath() {
    const envPath = process.env.YTDLP_PATH ? String(process.env.YTDLP_PATH).trim() : '';
    if (envPath) {
        // Resolve relative paths from the project root (__dirname/..)
        if (!path.isAbsolute(envPath)) {
            return path.resolve(__dirname, '..', envPath);
        }
        return path.resolve(envPath);
    }
    // Fallback: check project-local bin directory
    const localBin = path.join(__dirname, '..', 'bin', 'yt-dlp');
    try {
        if (fs.existsSync(localBin)) return localBin;
    } catch {}
    return 'yt-dlp';
}

/**
 * Returns the absolute path to the ffmpeg binary.
 * Priority: FFMPEG_PATH env var → ./bin/ffmpeg (project-local) → 'ffmpeg' (PATH)
 */
function getFfmpegPath() {
    const envPath = process.env.FFMPEG_PATH ? String(process.env.FFMPEG_PATH).trim() : '';
    if (envPath) {
        if (!path.isAbsolute(envPath)) {
            return path.resolve(__dirname, '..', envPath);
        }
        return path.resolve(envPath);
    }
    // Fallback: check project-local bin directory
    const localBin = path.join(__dirname, '..', 'bin', 'ffmpeg');
    try {
        if (fs.existsSync(localBin)) return localBin;
    } catch {}
    return 'ffmpeg';
}

/**
 * Returns the absolute path to the Deno binary, or null if not found.
 * Priority: YTDLP_DENO_PATH env var → ./bin/deno (project-local) → 'deno' (PATH)
 * Deno is used by yt-dlp as a JavaScript runtime to solve YouTube's
 * signature/cipher challenges and unlock real video/audio format URLs.
 */
function getDenoPath() {
    const envPath = process.env.YTDLP_DENO_PATH ? String(process.env.YTDLP_DENO_PATH).trim() : '';
    if (envPath) {
        if (!path.isAbsolute(envPath)) {
            const resolved = path.resolve(__dirname, '..', envPath);
            try { if (fs.existsSync(resolved)) return resolved; } catch {}
        }
        return path.resolve(envPath);
    }
    // Fallback: check project-local bin directory
    const localBin = path.join(__dirname, '..', 'bin', 'deno');
    try {
        if (fs.existsSync(localBin)) return localBin;
    } catch {}
    // Check PATH
    try {
        const which = require('child_process').spawnSync('which', ['deno'], { stdio: 'pipe' });
        if (which.status === 0) {
            const p = String(which.stdout).trim();
            if (p) return p;
        }
    } catch {}
    return null;
}

/**
 * Returns the --js-runtimes CLI args array if a Deno binary is available,
 * otherwise returns an empty array.
 * yt-dlp uses this flag to specify the JavaScript runtime for solving
 * YouTube signature challenges. Without this, formats will lack real URLs.
 */
function getJsRuntimeArgs() {
    const denoPath = getDenoPath();
    if (denoPath) {
        return ['--js-runtimes', denoPath];
    }
    return [];
}

/**
 * Returns the path to the SOURCE read-only cookies.txt file
 * (the Render Secret File or user-provided path).
 */
function getSourceCookiesPath() {
    const envPath = process.env.YTDLP_COOKIES_PATH ?
        String(process.env.YTDLP_COOKIES_PATH).trim() :
        '/etc/secrets/cookies.txt';
    try {
        if (fs.existsSync(envPath)) {
            return path.resolve(envPath);
        }
    } catch {}
    return null;
}

/**
 * Copies the cookies file from the read-only source path to a writable temp location.
 * This prevents OSError: [Errno 30] Read-only file system when yt-dlp tries to
 * write updated cookies back to the file. Call once at server startup.
 * Returns the writable path on success, or null if no source cookies file exists / copy fails.
 */
function initCookiesCopy() {
    const srcPath = getSourceCookiesPath();
    if (!srcPath) {
        _writableCookiesPath = null;
        return null;
    }
    try {
        fs.mkdirSync(WRITABLE_COOKIES_DIR, { recursive: true });
        fs.copyFileSync(srcPath, WRITABLE_COOKIES_FILE);
        // Ensure it's writable (not read-only even if source was)
        try { fs.chmodSync(WRITABLE_COOKIES_FILE, 0o644); } catch {}
        _writableCookiesPath = WRITABLE_COOKIES_FILE;
        console.log('[yt-dlp] Cookies file copied to writable location:', _writableCookiesPath);
        return _writableCookiesPath;
    } catch (err) {
        console.error('[yt-dlp] FAILED to copy cookies file from "' + srcPath + '" to "' + WRITABLE_COOKIES_FILE + '":', err.message);
        _writableCookiesPath = null;
        return null;
    }
}

/**
 * Returns the path to the cookies.txt file for authenticated YouTube requests.
 * Returns the WRITABLE copy if available (created by initCookiesCopy), otherwise
 * falls back to the source secret file path if it exists, or null.
 */
function getCookiesPath() {
    // First, return the writable copy if it was created
    if (_writableCookiesPath && fs.existsSync(_writableCookiesPath)) {
        return _writableCookiesPath;
    }
    // Fallback to source read-only path (for backward compat / local dev)
    return getSourceCookiesPath();
}

/**
 * Returns the --cookies CLI args array if a cookies file is available, otherwise empty array.
 * Use this in all yt-dlp command constructions.
 */
function getCookiesArgs() {
    const cp = getCookiesPath();
    if (cp) return ['--cookies', cp];
    return [];
}

function runProcess({ command, args, onStdoutLine, onStderrLine, timeoutMs = 0 }) {
    return new Promise((resolve, reject) => {
        try { console.log('[yt-dlp] spawn', command, JSON.stringify(args)); } catch {}

        const child = spawn(command, args, { windowsHide: true });

        let stdout = '';
        let stderr = '';

        const splitLines = (s) => String(s).split(/\r?\n/).filter(Boolean);

        if (onStdoutLine) {
            child.stdout.on('data', (chunk) => {
                const str = chunk.toString('utf8');
                stdout += str;
                for (const line of splitLines(str)) onStdoutLine(line);
            });
        } else {
            child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
        }

        if (onStderrLine) {
            child.stderr.on('data', (chunk) => {
                const str = chunk.toString('utf8');
                stderr += str;
                for (const line of splitLines(str)) onStderrLine(line);
            });
        } else {
            child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        }

        let timeout;
        if (timeoutMs > 0) {
            timeout = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch {}
                const err = new Error('yt-dlp timed out');
                err.statusCode = 504;
                reject(err);
            }, timeoutMs);
        }

        child.on('error', (err) => {
            if (timeout) clearTimeout(timeout);
            reject(err);
        });

        child.on('close', (code) => {
            if (timeout) clearTimeout(timeout);
            if (code === 0) {
                resolve({ code, stdout, stderr });
            } else {
                console.error('[yt-dlp][raw-stderr]', stderr);
                const err = new Error(`yt-dlp exited with code ${code}`);
                err.statusCode = 500;
                err.stderr = stderr;
                err.stdout = stdout;
                reject(err);
            }
        });
    });
}

function escapeForTemplate(s) {
    return String(s).replace(/[\\/:*?"<>|]+/g, '_');
}

function validateYouTubeUrl(urlStr) {
    if (typeof urlStr !== 'string') {
        const err = new Error('Invalid URL. Expected a string.');
        err.statusCode = 400;
        throw err;
    }
    const url = urlStr.trim();
    if (!url) {
        const err = new Error('Invalid URL: empty value');
        err.statusCode = 400;
        throw err;
    }

    if (url.includes('VIDEO_ID')) {
        const err = new Error('Invalid URL: appears to contain placeholder "VIDEO_ID"');
        err.statusCode = 400;
        throw err;
    }

    const youtubeWatch = /^https?:\/\/(?:www\.)?(?:youtube\.com|m\.youtube\.com)\/watch\?v=([A-Za-z0-9_-]{11})(?:[&#?].*)?$/i;
    const youtubeShort = /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{11})(?:[&#?].*)?$/i;

    if (!youtubeWatch.test(url) && !youtubeShort.test(url)) {
        const err = new Error('Invalid URL: must be a valid YouTube link (youtube.com/watch?v=... or youtu.be/...).');
        err.statusCode = 400;
        throw err;
    }

    return url;
}

function parseDumpJsonToInfo(raw) {
    let obj;
    try {
        obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        const lastBrace = String(raw).lastIndexOf('{');
        if (lastBrace >= 0) obj = JSON.parse(String(raw).slice(lastBrace));
        else throw new Error('Failed to parse yt-dlp JSON');
    }

    const title = obj.title || 'download';
    const thumbnail = (obj && obj.thumbnail) ? obj.thumbnail :
        ((obj && obj.thumbnails && obj.thumbnails[0] && obj.thumbnails[0].url) ? obj.thumbnails[0].url : null);
    const duration = typeof obj.duration === 'number' ? obj.duration : null;

    const formats = Array.isArray(obj.formats) ? obj.formats : [];

    // Issue 2 debug
    console.log('[yt-dlp][dump-json] raw formats array length:', formats.length);
    console.log(
        '[yt-dlp][dump-json] formats sample (first 3):',
        formats.slice(0, 3).map((f) => ({
            format_id: f.format_id,
            label: f.format_note || f.format_id,
            filesize: f.filesize,
            filesize_approx: f.filesize_approx,
            tbr: f.tbr,
            abr: f.abr,
            vbr: f.vbr,
            duration: f.duration,
        }))
    );

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '';
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
    }

    function pickSizeBytesFromFormat(f) {
        const filesize = typeof f.filesize === 'number' ? f.filesize : undefined;
        const filesizeApprox = typeof f.filesize_approx === 'number' ? f.filesize_approx : undefined;

        if (Number.isFinite(filesize) && filesize > 0) return filesize;
        if (Number.isFinite(filesizeApprox) && filesizeApprox > 0) return filesizeApprox;

        // fallback: estimated_bytes = (tbr_kbps * 1000 / 8) * duration_seconds
        const tbrKbps = Number(f.tbr != null ? f.tbr : (f.abr != null ? f.abr : (f.vbr != null ? f.vbr : 0)));
        const durationSec = typeof obj.duration === 'number' ? obj.duration : duration;

        if (Number.isFinite(tbrKbps) && tbrKbps > 0 && Number.isFinite(durationSec) && durationSec > 0) {
            const estimatedBytes = (tbrKbps * 1000 / 8) * durationSec;
            if (Number.isFinite(estimatedBytes) && estimatedBytes > 0) return estimatedBytes;
        }

        return undefined;
    }

    const unique = new Map(); // label -> { format_id, label, ext, filesizeBytes, filesizeLabel }

    function considerVideo(targetHeight) {
        const candidates = formats
            .filter((f) => f.vcodec && f.vcodec !== 'none' && typeof f.height === 'number')
            .filter((f) => f.height <= targetHeight)
            .map((f) => ({ f, dist: targetHeight - f.height }));

        if (!candidates.length) return;

        candidates.sort((a, b) => {
            const da = a.dist - b.dist;
            if (da !== 0) return da;

            const sa = pickSizeBytesFromFormat(a.f) || 0;
            const sb = pickSizeBytesFromFormat(b.f) || 0;
            return sb - sa;
        });

        const best = candidates[0].f;
        const filesizeBytes = pickSizeBytesFromFormat(best);

        unique.set(`${targetHeight}p`, {
            label: `${targetHeight}p`,
            format_id: String(best.format_id),
            ext: best.ext || 'mp4',
            filesizeBytes,
            filesizeLabel: formatBytes(filesizeBytes) || 'Size unknown',
        });
    }

    function considerAudioMp3() {
        const candidates = formats
            .filter((f) => (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none')
            .map((f) => f);

        if (!candidates.length) return;

        candidates.sort((a, b) => {
            const abrA = Number(a.abr != null ? a.abr : (a.tbr != null ? a.tbr : 0));
            const abrB = Number(b.abr != null ? b.abr : (b.tbr != null ? b.tbr : 0));
            return abrB - abrA;
        });

        const best = candidates[0];
        const filesizeBytes = pickSizeBytesFromFormat(best);

        unique.set('MP3 audio', {
            label: 'audio-only MP3',
            format_id: 'mp3-' + String(best.format_id),
            ext: 'mp3',
            filesizeBytes,
            filesizeLabel: formatBytes(filesizeBytes) || 'Size unknown',
        });
    }

    considerVideo(1080);
    considerVideo(720);
    considerVideo(480);
    considerAudioMp3();

    if (unique.size === 0) {
        unique.set('best', {
            label: 'best',
            format_id: 'best',
            ext: 'mp4',
            filesizeBytes: undefined,
            filesizeLabel: 'Size unknown',
        });
    }

    return {
        title,
        thumbnail,
        duration,
        formats: [...unique.values()],
    };
}

async function runDumpJson(url) {
    const validated = validateYouTubeUrl(url);
    console.log('[yt-dlp] dump URL:', validated);

    const ytDlpCmd = getYtDlpPath();
    const jsArgs = getJsRuntimeArgs();

    const args = [
        '--dump-json',
        '--no-playlist',
        '--retries', '3',
        '--fragment-retries', '3',
        '--no-continue',
        '--user-agent', process.env.YTDLP_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
        ...getCookiesArgs(),
        ...jsArgs,
        validated,
    ];
    const { stdout, stderr } = await runProcess({ command: ytDlpCmd, args });

    if (!stdout || !String(stdout).trim().startsWith('{')) {
        const err = new Error('yt-dlp did not return JSON');
        err.stderr = stderr;
        err.statusCode = 500;
        throw err;
    }

    return stdout;
}

async function runDownloadToFile({ url, formatId, outDir, outNameBase }) {
    const validated = validateYouTubeUrl(url);

    const safeBase = escapeForTemplate(outNameBase || 'download');
    const outPattern = path.join(outDir, `${safeBase}.%(ext)s`);

    const formatIdStr = String(formatId || '').trim();
    if (!formatIdStr) {
        const err = new Error('Missing format_id');
        err.statusCode = 400;
        throw err;
    }

    const ffmpegPath = process.env.FFMPEG_PATH ? String(process.env.FFMPEG_PATH).trim() : '';
    const ffCmd = ffmpegPath || 'ffmpeg';
    console.log('[yt-dlp] download URL:', validated);

    const jsArgs = getJsRuntimeArgs();

    // Keep existing behavior: if MP3 requested, extract audio; otherwise force mp4 merge.
    const isMp3Choice = formatIdStr.toLowerCase().includes('mp3');

    let args;
    const common = [
        '--no-playlist',
        '--newline',
        '--retries', '3',
        '--fragment-retries', '3',
        '--no-continue',
        '--user-agent', process.env.YTDLP_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
        '--accept-language', process.env.YTDLP_ACCEPT_LANGUAGE || 'en-US,en;q=0.9',
        ...getCookiesArgs(),
        ...(jsArgs),
    ];

    const ytDlpCmd = getYtDlpPath();

    if (isMp3Choice) {
        args = [
            '-f', 'bestaudio/best',
            '-o', outPattern,
            '--extract-audio',
            '--audio-format', 'mp3',
            ...(ffmpegPath ? ['--ffmpeg-location', ffmpegPath] : []),
            ...common,
            validated,
        ];
    } else {
        const bestVideoAudioMp4 = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best[ext=mp4]';
        // (If that selector is too strict, yt-dlp will still try fallbacks with the next entries)
        args = [
            '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            '--no-playlist',
            '-o', outPattern,
            '--newline',
            '--merge-output-format', 'mp4',
            ...(ffmpegPath ? ['--ffmpeg-location', ffmpegPath] : []),
            validated,
        ];
    }

    await runProcess({ command: ytDlpCmd, args, timeoutMs: 0 });

    // Find produced file (after merge/extract)
    const files = fs.readdirSync(outDir);
    const candidates = files
        .filter((fn) => fn.startsWith(safeBase + '.'))
        .map((fn) => ({ fp: path.join(outDir, fn) }));

    if (!candidates.length) {
        const err = new Error('yt-dlp did not produce an output file');
        err.statusCode = 500;
        throw err;
    }

    candidates.sort((a, b) => fs.statSync(b.fp).mtimeMs - fs.statSync(a.fp).mtimeMs);
    const filePath = candidates[0].fp;

    const ext = path.extname(filePath).replace('.', '').toLowerCase();
    const mimeType =
        ext === 'mp3' ? 'audio/mpeg' :
        ext === 'mp4' ? 'video/mp4' :
        'application/octet-stream';

    try {
        const mb = fs.statSync(filePath).size / (1024 * 1024);
        console.log('[yt-dlp] returning merged file:', { filePath, sizeMb: Number(mb.toFixed(3)) });
    } catch {}

    return { filePath, mimeType, ext: ext || null };
}

module.exports = {
    getYtDlpPath,
    getFfmpegPath,
    getDenoPath,
    getJsRuntimeArgs,
    getCookiesPath,
    getCookiesArgs,
    getSourceCookiesPath,
    initCookiesCopy,
    runDumpJson,
    runDownloadToFile,
    parseDumpJsonToInfo,
};