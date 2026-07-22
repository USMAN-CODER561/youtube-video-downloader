const { spawn } = require('child_process');
const { getYtDlpPath, getCookiesArgs } = require('./ytDlp');

function runProcessStreaming({ command, args, onStdoutLine, onStderrLine }) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: true });

        const splitLines = (s) => String(s).split(/\r?\n/).filter(Boolean);

        if (child.stdout && onStdoutLine) {
            child.stdout.on('data', (chunk) => {
                const str = chunk.toString('utf8');
                for (const line of splitLines(str)) onStdoutLine(line);
            });
        }

        if (child.stderr && onStderrLine) {
            child.stderr.on('data', (chunk) => {
                const str = chunk.toString('utf8');
                for (const line of splitLines(str)) onStderrLine(line);
            });
        }

        child.on('error', reject);

        child.on('close', (code) => {
            if (code === 0) return resolve({ code });
            reject(new Error(`yt-dlp exited with code ${code}`));
        });
    });
}

function buildArgsForProgress({ url, formatId, outPattern, isMp3Choice, ffmpegPath }) {
    const common = [
        '--newline',
        '--progress',
        '--progress-template',
        '%(progress)j',
        ...getCookiesArgs(),
    ];

    if (isMp3Choice) {
        return [
            '-f', 'bestaudio/best',
            '--no-playlist',
            '-o', outPattern,
            '--extract-audio',
            '--audio-format', 'mp3',
            ...(ffmpegPath ? ['--ffmpeg-location', ffmpegPath] : []),
            ...common,
            url,
        ];
    }

    // Determine the format specification based on formatId selection
    let formatSpec;
    if (formatId && formatId !== 'best') {
        // Strip the formatId of non-alphanumeric chars just to be safe
        const cleanFormatId = String(formatId).replace(/[^A-Za-z0-9_-]/g, '');
        formatSpec = `${cleanFormatId}+bestaudio/best`;
    } else {
        formatSpec = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    }

    // Merge into mp4
    return [
        '-f', formatSpec,
        '--no-playlist',
        '-o', outPattern,
        '--merge-output-format', 'mp4',
        ...(ffmpegPath ? ['--ffmpeg-location', ffmpegPath] : []),
        ...common,
        url,
    ];
}

function parseProgressJsonLine(line) {
    const s = String(line).trim();
    if (!s.startsWith('{') || !s.endsWith('}')) return null;
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

function computePercent(parsed) {
    if (typeof parsed._percent === 'number') {
        return Math.max(0, Math.min(100, Math.round(parsed._percent)));
    }
    const d = Number(parsed.downloaded_bytes);
    const t = Number(parsed.total_bytes);
    if (!Number.isFinite(d) || d < 0) return 0;
    if (!Number.isFinite(t) || t <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((d / t) * 100)));
}

async function runDownloadWithProgress({ url, formatId, outPattern, onProgress, ffmpegPath }) {
    const isMp3Choice = String(formatId).toLowerCase().includes('mp3');

    const args = buildArgsForProgress({
        url,
        formatId,
        outPattern,
        isMp3Choice,
        ffmpegPath: ffmpegPath || ''
    });

    const ytDlpCmd = getYtDlpPath();
    await runProcessStreaming({
        command: ytDlpCmd,
        args,
        onStdoutLine: (line) => {
            const parsed = parseProgressJsonLine(line);
            if (!parsed) return;

            const percent = computePercent(parsed);
            const payload = {
                status: parsed.status,
                downloaded_bytes: parsed.downloaded_bytes,
                total_bytes: parsed.total_bytes,
                speed: parsed._speed_str ? parsed._speed_str.trim() : (parsed.speed ? `${(parsed.speed / 1024).toFixed(1)} KiB/s` : null),
                eta_seconds: typeof parsed.eta === 'number' ? parsed.eta : null,
                percent,
            };

            // backend-side log for progress
            console.log('[yt-dlp][progress]', payload);

            onProgress && onProgress(payload);
        },
        onStderrLine: (line) => {
            console.warn('[yt-dlp][stderr]', line);
        },
    });
}

module.exports = {
    runDownloadWithProgress,
};