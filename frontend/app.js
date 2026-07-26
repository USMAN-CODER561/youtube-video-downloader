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

// ============================================================
// 3. SKELETON LOADING
// ============================================================
const skeletonWrap = document.getElementById('skeletonWrap');
const fallbackSpinner = document.getElementById('fallbackSpinner');

function showSkeleton() {
    if (skeletonWrap) {
        setHidden(skeletonWrap, false);
    }
    if (fallbackSpinner) {
        setHidden(fallbackSpinner, true);
    }
}

function hideSkeleton() {
    if (skeletonWrap) {
        setHidden(skeletonWrap, true);
    }
}

// Patch the handleFetchVideo to show skeleton instead of spinner
// by wrapping the original fetchState logic.
const origSetHidden_fetch = setHidden;
// We'll hook into handleFetchVideo by patching show/hide of fetchState.
// Instead of modifying handleFetchVideo, we override the setHidden for fetchState
// in a patch that runs when fetchState visibility changes.
// Simpler: directly call showSkeleton/hideSkeleton in the fetch handler patches.

// Store original fetch handler behavior then enhance it.
(function patchFetchSkeleton() {
    const origFetchFn = window.handleFetchVideo;
    // We won't replace handleFetchVideo, we'll add observer approach.
    // Actually easiest: directly modify handleFetchVideo below by appending to the function.
    // Since we're adding code after, we can't modify it. Let's use a MutationObserver on fetchState.
    if (!fetchState) return;
    const observer = new MutationObserver(() => {
        if (!fetchState.classList.contains('hidden')) {
            showSkeleton();
        }
    });
    observer.observe(fetchState, { attributes: true, attributeFilter: ['class'] });
})();

// Also call hideSkeleton when preview is shown — patch preview visibility.
(function patchPreviewSkeleton() {
    if (!preview) return;
    const obs = new MutationObserver(() => {
        if (!preview.classList.contains('hidden')) {
            hideSkeleton();
            // Add fade-in animation
            preview.classList.remove('fadeInContent');
            // Force reflow
            void preview.offsetWidth;
            preview.classList.add('fadeInContent');
        }
    });
    obs.observe(preview, { attributes: true, attributeFilter: ['class'] });
})();

// ============================================================
// 4. RECENT LINKS (session-based, resets on refresh)
// ============================================================
const recentLinksEl = document.getElementById('recentLinks');
let recentLinks = []; // each: { url, title }

function addRecentLink(url, title) {
    // Remove duplicate if exists, move to top
    recentLinks = recentLinks.filter(item => item.url !== url);
    recentLinks.unshift({ url, title: title || url });
    // Keep max 5
    recentLinks = recentLinks.slice(0, 5);
    renderRecentLinks();
}

function renderRecentLinks() {
    if (!recentLinksEl) return;
    if (!recentLinks.length) {
        recentLinksEl.innerHTML = '';
        return;
    }
    recentLinksEl.innerHTML = '';
    for (const item of recentLinks) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'recentPill';
        pill.textContent = item.title || item.url;
        pill.title = item.url;
        pill.addEventListener('click', () => {
            urlInput.value = item.url;
            // Auto-trigger fetch
            handleFetchVideo();
        });
        recentLinksEl.appendChild(pill);
    }
}

// Patch handleFetchVideo to add recent link on success
(function patchRecentLinks() {
    const orig = window.handleFetchVideo;
    // We'll use a post-fetch hook via intercepting setHidden(preview, false)
    const obs = new MutationObserver(() => {
        if (!preview.classList.contains('hidden')) {
            const url = urlInput.value.trim();
            const title = titleEl ? titleEl.textContent : url;
            if (url) {
                addRecentLink(url, title);
            }
        }
    });
    if (preview) {
        obs.observe(preview, { attributes: true, attributeFilter: ['class'] });
    }
})();

// ============================================================
// 5. COPY DOWNLOAD LINK
// ============================================================
const toastEl = document.getElementById('toast');

function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    setHidden(toastEl, false);
    // After 2 seconds, fade out
    clearTimeout(toastEl._hideTimer);
    toastEl._hideTimer = setTimeout(() => {
        setHidden(toastEl, true);
    }, 2000);
}

// Patch renderHistory to add copy buttons
const origRenderHistory = renderHistory;
renderHistory = function() {
    origRenderHistory.call(this);
    // Add copy buttons to each history item
    if (!historyList) return;
    const items = historyList.querySelectorAll('.historyItem');
    items.forEach((el, idx) => {
        // Avoid duplicating if already has copyBtn
        if (el.querySelector('.copyBtn')) return;
        const item = history[idx];
        if (!item) return;

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'copyBtn';
        copyBtn.setAttribute('aria-label', 'Copy download link');
        copyBtn.innerHTML = '📋';

        // Tooltip for errors
        const tooltip = document.createElement('span');
        tooltip.className = 'copyTooltip';
        tooltip.textContent = 'Copy link';
        copyBtn.appendChild(tooltip);

        copyBtn.addEventListener('click', async(e) => {
            e.stopPropagation();
            // Build the download link — we store the download URL in the history item
            // Since we don't store the actual download URL, we use the history item's
            // video URL to reconstruct.
            const videoUrl = item._downloadUrl || '';
            if (!videoUrl) {
                // Try to provide feedback
                tooltip.textContent = 'No link available';
                tooltip.classList.add('show');
                setTimeout(() => tooltip.classList.remove('show'), 1500);
                return;
            }
            try {
                await navigator.clipboard.writeText(videoUrl);
                showToast('Link copied!');
            } catch (err) {
                tooltip.textContent = 'Copy failed';
                tooltip.classList.add('show');
                setTimeout(() => tooltip.classList.remove('show'), 1500);
            }
        });

        el.appendChild(copyBtn);
    });
};

// Store download URL in history when adding
const origAddHistoryItem = addHistoryItem;
addHistoryItem = function({ title, thumbnail, formatLabel, downloadUrl }) {
    origAddHistoryItem.call(this, { title, thumbnail, formatLabel });
    // Store download URL on the first item
    if (history.length > 0 && downloadUrl) {
        history[0]._downloadUrl = downloadUrl;
    }
    renderHistory();
};

// ============================================================
// 2. FAQ ACCORDION
// ============================================================
document.querySelectorAll('.faqQuestion').forEach(btn => {
    btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        // Close all others
        document.querySelectorAll('.faqQuestion').forEach(other => {
            if (other !== btn) {
                other.setAttribute('aria-expanded', 'false');
            }
        });
        btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    });
});

// ============================================================
// 6. FEEDBACK / REPORT ISSUE
// ============================================================
const reportBtn = document.getElementById('reportBtn');
const feedbackModal = document.getElementById('feedbackModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const feedbackForm = document.getElementById('feedbackForm');
const feedbackText = document.getElementById('feedbackText');
const feedbackUrl = document.getElementById('feedbackUrl');
const feedbackError = document.getElementById('feedbackError');
const feedbackSubmitBtn = document.getElementById('feedbackSubmitBtn');
const feedbackThanks = document.getElementById('feedbackThanks');

function openFeedbackModal() {
    if (!feedbackModal) return;
    // Auto-fill URL from input if present
    const currentUrl = urlInput ? urlInput.value.trim() : '';
    if (feedbackUrl) feedbackUrl.value = currentUrl;
    if (feedbackText) feedbackText.value = '';
    if (feedbackError) setHidden(feedbackError, true);
    if (feedbackThanks) setHidden(feedbackThanks, true);
    if (feedbackForm) setHidden(feedbackForm, false);
    setHidden(feedbackModal, false);
}

function closeFeedbackModal() {
    if (feedbackModal) setHidden(feedbackModal, true);
}

if (reportBtn) {
    reportBtn.addEventListener('click', openFeedbackModal);
}

if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeFeedbackModal);
}

// Close modal on overlay click
if (feedbackModal) {
    feedbackModal.addEventListener('click', (e) => {
        if (e.target === feedbackModal) {
            closeFeedbackModal();
        }
    });
}

// Escape key closes modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && feedbackModal && !feedbackModal.classList.contains('hidden')) {
        closeFeedbackModal();
    }
});

if (feedbackForm) {
    feedbackForm.addEventListener('submit', async(e) => {
        e.preventDefault();
        if (feedbackSubmitBtn) feedbackSubmitBtn.disabled = true;
        if (feedbackError) setHidden(feedbackError, true);

        const text = feedbackText ? feedbackText.value.trim() : '';
        const url = feedbackUrl ? feedbackUrl.value.trim() : '';

        if (!text) {
            if (feedbackError) {
                feedbackError.textContent = 'Please describe the issue.';
                setHidden(feedbackError, false);
            }
            if (feedbackSubmitBtn) feedbackSubmitBtn.disabled = false;
            return;
        }

        try {
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, url })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) {
                throw new Error(data.error || 'Failed to submit');
            }
            // Show thanks
            if (feedbackForm) setHidden(feedbackForm, true);
            if (feedbackThanks) setHidden(feedbackThanks, false);
            setTimeout(closeFeedbackModal, 2000);
        } catch (err) {
            if (feedbackError) {
                feedbackError.textContent = err.message || 'Failed to submit. Try again.';
                setHidden(feedbackError, false);
            }
        } finally {
            if (feedbackSubmitBtn) feedbackSubmitBtn.disabled = false;
        }
    });
}

// ============================================================
// 1. HOW IT WORKS — Scroll-triggered fade-in
// ============================================================
(function initFadeInOnScroll() {
    if (!('IntersectionObserver' in window)) {
        // Fallback: show all immediately
        document.querySelectorAll('.fadeInItem').forEach(el => el.classList.add('visible'));
        return;
    }
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Optionally unobserve after showing
                observer.unobserve(entry.target);
            }
        }
    }, { threshold: 0.15 });
    document.querySelectorAll('.fadeInItem').forEach(el => observer.observe(el));
})();

async function fetchInfo(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
        const res = await fetch('/api/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to fetch video info');
        }
        return data.video;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('Request timed out, YouTube is taking too long to respond.');
        }
        throw err;
    }
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
    if (fetchStateText) fetchStateText.textContent = 'Fetching video info… (may take up to 30s on first load)';

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
    if (progressSubText) progressSubText.textContent = 'Preparing… (may take up to 30s on first load)';

    try {
        // 1) Start download job (backend returns jobId immediately) — with 45s timeout (cold-start friendly)
        const downloadController = new AbortController();
        const downloadTimeoutId = setTimeout(() => downloadController.abort(), 45000);

        let startRes;
        try {
            startRes = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, format_id }),
                signal: downloadController.signal
            });
        } catch (err) {
            clearTimeout(downloadTimeoutId);
            if (err.name === 'AbortError') {
                throw new Error('Request timed out, YouTube is taking too long to respond.');
            }
            throw err;
        }
        clearTimeout(downloadTimeoutId);

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
                    const absDownloadUrl = window.location.origin + downloadUrl;
                    addHistoryItem({ title, thumbnail: thumbSrc, formatLabel, downloadUrl: absDownloadUrl });
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

// --- Service Worker Registration ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').then((reg) => {
            console.log('[SW] Registered successfully, scope:', reg.scope);
        }, (err) => {
            console.warn('[SW] Registration failed:', err);
        });
    });
} else {
    console.log('[SW] Service workers not supported in this browser');
}

// --- Install App (PWA) Button ---
const installBtn = document.getElementById('installBtn');
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the automatic mini-infobar on Android Chrome
    e.preventDefault();
    // Store the event so we can trigger it later
    deferredPrompt = e;
    // Show the install button
    if (installBtn) {
        installBtn.classList.remove('hidden');
    }
    console.log('[PWA] beforeinstallprompt fired — install button shown');
});

window.addEventListener('appinstalled', () => {
    // The app was installed — hide the button
    if (installBtn) {
        installBtn.classList.add('hidden');
    }
    deferredPrompt = null;
    console.log('[PWA] App was installed');
});

if (installBtn) {
    installBtn.addEventListener('click', async() => {
        if (!deferredPrompt) {
            console.log('[PWA] No install prompt available (likely already installed or unsupported)');
            return;
        }
        // Show the browser's install prompt
        deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        console.log('[PWA] User choice:', result.outcome);
        // Reset — prompt can only be used once
        deferredPrompt = null;
        // Hide button after install (or dismissal)
        installBtn.classList.add('hidden');
    });
}

// --- Cookie status indicator ---
const cookieDot = document.getElementById('cookieDot');
const cookieLabel = document.getElementById('cookieLabel');

async function updateCookieStatus() {
    try {
        const res = await fetch('/api/cookie-status');
        const data = await res.json();
        if (!data || typeof data.ok !== 'boolean') throw new Error('invalid response');

        if (data.ok) {
            cookieDot.className = 'cookieDot ok';
            cookieLabel.textContent = 'Cookies: OK';
        } else {
            cookieDot.className = 'cookieDot err';
            cookieLabel.textContent = 'Cookies: Expired';
        }
    } catch (e) {
        cookieDot.className = 'cookieDot err';
        cookieLabel.textContent = 'Cookies: Error';
    }
}

// Initial check on page load
cookieDot.className = 'cookieDot checking';
cookieLabel.textContent = 'Cookies: checking…';
updateCookieStatus();
// Re-check every 5 minutes (300000ms) to catch expiration
setInterval(updateCookieStatus, 300000);

initHistory();
renderHistory();