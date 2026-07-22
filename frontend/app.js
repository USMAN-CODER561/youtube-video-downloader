const urlForm = document.getElementById('urlForm');
const urlInput = document.getElementById('urlInput');
const fetchBtn = document.getElementById('fetchBtn');
const fetchState = document.getElementById('fetchState');
const fetchStateText = document.getElementById('fetchStateText');
const downloadBtn = document.getElementById('downloadBtn');
const downloadState = document.getElementById('downloadState');
const downloadStateText = document.getElementById('downloadStateText');
const errorBox = document.getElementById('errorBox');

const preview = document.getElementById('preview');
const thumb = document.getElementById('thumb');
const titleEl = document.getElementById('title');
const durationEl = document.getElementById('duration');
const formatSelect = document.getElementById('formatSelect');

const progressWrap = document.getElementById('progressWrap');
const progressBarFill = document.getElementById('progressBarFill');
const progressLabel = document.getElementById('progressLabel');
const progressSubText = document.getElementById('progressSubText');

const formatChips = document.getElementById('formatChips');

const historyList = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const historyCount = document.getElementById('historyCount');

function setHidden(el, hidden) {
    if (!el) return;
    el.classList.toggle('hidden', !!hidden);
}

function setError(msg) {
    if (!errorBox) return;
    if (!msg) {
        setHidden(errorBox, true);
        errorBox.textContent = '';
        return;
    }
    errorBox.textContent = msg;
    setHidden(errorBox, false);
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return '';
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    if (h > 0) return `${h}h ${m}m ${rem}s`;
    if (m > 0) return `${m}m ${rem}s`;
    return `${rem}s`;
}

function setProgress(percent, text, subText) {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    if (progressBarFill) progressBarFill.style.width = `${p}%`;
    if (progressLabel) progressLabel.textContent = `${p}%`;
    if (text && downloadStateText) downloadStateText.textContent = text;
    if (subText && progressSubText) progressSubText.textContent = subText;
    setHidden(progressWrap, false);
}

function clearFormatChips() {
    if (!formatChips) return;
    formatChips.innerHTML = '';
}

function setSelectedFormat(format_id) {
    if (formatSelect) formatSelect.value = format_id;
    if (!formatChips) return;
    for (const chip of formatChips.querySelectorAll('[data-format-id]')) {
        const sel = chip.getAttribute('data-format-id') === format_id;
        chip.setAttribute('aria-selected', sel ? 'true' : 'false');
    }
}

function addFormatChip({ format_id, label, filesizeLabel }) {
    if (!formatChips) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', 'false');
    btn.dataset.formatId = format_id;

    const sizeTxt = (typeof filesizeLabel === 'string' && filesizeLabel.trim()) ? filesizeLabel : 'Size unknown';
    btn.textContent = `${label} — ${sizeTxt}`;

    btn.addEventListener('click', () => {
        setSelectedFormat(format_id);
    });
    formatChips.appendChild(btn);
}


function initHistory() {
    const count = historyCount;
    if (count) count.textContent = '0';
    if (historyList) historyList.innerHTML = '';
    if (historyEmpty) setHidden(historyEmpty, false);
}

function setHistoryEmpty(isEmpty) {
    if (!historyEmpty) return;
    setHidden(historyEmpty, !isEmpty);
}

let history = [];

function addHistoryItem({ title, thumbnail, formatLabel }) {
    history.unshift({
        title,
        thumbnail,
        formatLabel,
        ts: Date.now()
    });

    // Keep it reasonably small
    history = history.slice(0, 8);
    renderHistory();
}

function timeAgo(ts) {
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    return `${hr}h ago`;
}

function renderHistory() {
    if (!historyList) return;
    historyList.innerHTML = '';

    if (!history.length) {
        setHistoryEmpty(true);
        if (historyCount) historyCount.textContent = '0';
        return;
    }

    setHistoryEmpty(false);
    if (historyCount) historyCount.textContent = String(history.length);

    for (const item of history) {
        const el = document.createElement('div');
        el.className = 'historyItem';

        const img = document.createElement('img');
        img.className = 'historyThumb';
        img.src = item.thumbnail || '';
        img.alt = item.title || 'thumbnail';

        const meta = document.createElement('div');
        meta.className = 'historyMeta';

        const name = document.createElement('div');
        name.className = 'historyName';
        name.textContent = item.title || '—';

        const sub = document.createElement('div');
        sub.className = 'historySub';
        sub.textContent = `${item.formatLabel || 'downloaded'} • ${timeAgo(item.ts)}`;

        meta.appendChild(name);
        meta.appendChild(sub);

        el.appendChild(img);
        el.appendChild(meta);
        historyList.appendChild(el);
    }
}

async function fetchInfo(url) {
    const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to fetch video info');
    }
    return data.video;
}

/**
 * Shared handler for fetching video info — called BOTH on form submit (Enter key)
 * AND on fetchBtn click. A single code path ensures consistent behavior.
 */
async function handleFetchVideo() {
    console.log('[frontend][handleFetchVideo] called at', new Date().toISOString());

    const url = urlInput.value.trim();

    setError('');
    setHidden(preview, true);
    setHidden(progressWrap, true);
    if (progressBarFill) progressBarFill.style.width = '0%';
    if (progressLabel) progressLabel.textContent = '0%';
    if (progressSubText) progressSubText.textContent = '';

    // disable
    fetchBtn.disabled = true;
    downloadBtn.disabled = true;
    urlInput.disabled = true;

    setHidden(fetchState, false);
    if (fetchStateText) fetchStateText.textContent = 'Fetching video info…';

    try {
        const video = await fetchInfo(url);

        thumb.src = video.thumbnail || '';
        thumb.alt = video.title || 'thumbnail';
        titleEl.textContent = video.title || '—';
        durationEl.textContent = formatDuration(video.duration);

        if (formatSelect) {
            formatSelect.innerHTML = '';
        }
        clearFormatChips();

        const formats = video.formats || [];
        for (const fmt of formats) {
            if (formatSelect) {
                const opt = document.createElement('option');
                opt.value = fmt.format_id;
                opt.textContent = fmt.label;
                formatSelect.appendChild(opt);
            }

            addFormatChip({
                format_id: fmt.format_id,
                label: fmt.label,
                filesizeLabel: fmt.filesizeLabel,
            });
        }

        // default select first format
        const first = formats[0];
        if (first) {
            setSelectedFormat(String(first.format_id));
            preview.dataset.url = url;
            downloadBtn.disabled = false;
        }

        setHidden(preview, false);
    } catch (err) {
        setError(err.message || 'Failed');
    } finally {
        setHidden(fetchState, true);
        fetchBtn.disabled = false;
        urlInput.disabled = false;
    }
}

// Form submit handler — fires when Enter is pressed in the URL input
urlForm.addEventListener('submit', async(e) => {
    console.log('[frontend][urlForm][submit] triggered at', new Date().toISOString());
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    await handleFetchVideo();
});

// Fetch button click handler — fires when button is clicked
fetchBtn.addEventListener('click', async() => {
    console.log('[frontend][fetchBtn][click] triggered at', new Date().toISOString());
    await handleFetchVideo();
});

downloadBtn.addEventListener('click', async() => {
    console.log('[DEBUG] Download button CLICKED at', new Date().toISOString());
    const url = preview.dataset.url;
    const format_id = formatSelect ? formatSelect.value : '';

    console.log('[DEBUG] Download params:', { url, format_id });

    if (!url || !format_id) {
        console.log('[DEBUG] Missing url or format_id, aborting');
        return;
    }

    const title = titleEl ? titleEl.textContent : '';
    const thumbSrc = thumb ? thumb.src : '';
    const formatLabel = (() => {
        if (!formatSelect || !formatSelect.options) return format_id;
        const opt = formatSelect.selectedOptions && formatSelect.selectedOptions[0];
        return (opt && opt.textContent) ? opt.textContent : format_id;
    })();

    setError('');

    // disable
    downloadBtn.disabled = true;
    fetchBtn.disabled = true;
    urlInput.disabled = true;

    setHidden(downloadState, false);
    setHidden(progressWrap, false);
    if (progressBarFill) progressBarFill.style.width = '0%';
    if (progressLabel) progressLabel.textContent = '0%';
    if (progressSubText) progressSubText.textContent = 'Preparing…';

    try {
        // 1) Start download job (backend returns jobId immediately)
        const startRes = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, format_id })
        });

        const startData = await startRes.json().catch(() => ({}));
        if (!startRes.ok || !startData.ok || !startData.jobId) {
            throw new Error(startData.error || 'Download failed to start');
        }

        const jobId = startData.jobId;

        // 2) Open SSE for server-side progress (preparing/merging phase)
        const es = new EventSource(`/api/progress/${encodeURIComponent(jobId)}`);

        es.onopen = () => {
            console.log('[frontend][SSE] connected', { jobId });
            setProgress(0, 'Downloading…', '');
        };

        es.onmessage = (ev) => {
            // SSE payload arrives as JSON string in data:
            try {
                console.log('[frontend][SSE][onmessage] raw:', ev.data);
                const data = JSON.parse(ev.data);

                if (!data || !data.ok || data.jobId !== jobId) return;

                const percent = data.percent ? data.percent : 0;
                const status = data.status || '';
                const speed = data.speed;
                const etaSeconds = data.eta_seconds;
                const downloadedBytes = data.downloaded_bytes;
                const totalBytes = data.total_bytes;

                // Live UI update
                let sub = '';
                if (Number.isFinite(totalBytes) && totalBytes > 0 && Number.isFinite(downloadedBytes)) {
                    const remainingBytes = Math.max(0, totalBytes - downloadedBytes);
                    sub = `Remaining: ${(remainingBytes / (1024 * 1024)).toFixed(1)} MB`;
                } else if (Number.isFinite(etaSeconds) && etaSeconds > 0) {
                    sub = `ETA: ${Math.ceil(etaSeconds)}s`;
                }

                const speedTxt = speed ? ` • ${speed}` : '';

                setProgress(percent, status || 'Downloading…', `${sub}${speedTxt}`);

                // When server-side preparation is finished, trigger native browser download
                if (status === 'finished') {
                    // IMPORTANT: Only trigger download if the backend confirms the file is actually ready on disk.
                    // yt-dlp sends multiple "finished" progress events (one per stream) during multi-stream downloads.
                    // The real file-ready signal includes _fileReady: true from the backend.
                    if (!data._fileReady) {
                        console.log('[frontend][SSE][finished] SKIPPING - intermediate yt-dlp stream finished, waiting for file-ready signal', { jobId, percent });
                        return;
                    }

                    es.close();
                    setProgress(100, 'Done', 'Triggering browser download…');

                    console.log('[frontend][download][finished] triggering native browser download for jobId', jobId);

                    // NATIVE BROWSER DOWNLOAD: navigate directly to the backend file URL
                    // The browser's native download manager will stream the file from the server
                    // and show real-time progress in Chrome's download bar
                    const downloadUrl = `/api/download/file/${encodeURIComponent(jobId)}`;
                    console.log('[DEBUG] download URL being navigated to:', window.location.origin + downloadUrl);

                    // Create a real <a> tag pointing to the backend URL (not a blob URL)
                    // This triggers the browser's native download manager with live streaming progress
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = ''; // Let the server's Content-Disposition header determine the filename
                    document.body.appendChild(a);
                    console.log('[DEBUG] Clicking download <a> with href:', a.href);
                    a.click();
                    a.remove();

                    // Update history optimistically — the download has started
                    // The browser will show real progress in its native download tray
                    addHistoryItem({ title, thumbnail: thumbSrc, formatLabel });
                }
                if (status === 'error') {
                    es.close();
                    setError('Download failed');
                }
            } catch (e) {
                console.log('[frontend][SSE] parse error', e);
            }
        };

        es.onerror = (e) => {
            console.log('[frontend][SSE] error', e);
        };

    } catch (err) {
        setError(err.message || 'Download failed');
    } finally {
        setHidden(downloadState, true);
        setHidden(fetchState, true);
        downloadBtn.disabled = false;
        fetchBtn.disabled = false;
        urlInput.disabled = false;
    }
});

initHistory();
renderHistory();