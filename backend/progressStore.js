// Simple in-memory store for SSE progress streams.
// Not persisted; good for single-process dev/debug.

const jobs = new Map();

function createJob(jobId) {
    if (jobs.has(jobId)) return jobs.get(jobId);
    const job = {
        id: jobId,
        status: 'queued',
        progress: {
            percent: 0,
            status: 'queued',
            downloaded_bytes: 0,
            total_bytes: null,
            speed: null,
            eta_seconds: null
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        // list of {res, onCloseCleanup}
        sseClients: new Set()
    };
    jobs.set(jobId, job);
    return job;
}

function getJob(jobId) {
    return jobs.get(jobId);
}

function deleteJob(jobId) {
    jobs.delete(jobId);
}

function setJobProgress(jobId, progressPatch) {
    const job = jobs.get(jobId);
    if (!job) return;

    job.status = (progressPatch && progressPatch.status) ? progressPatch.status : job.status;
    job.progress = {...job.progress, ...(progressPatch || {}) };

    job.updatedAt = Date.now();

    const payload = JSON.stringify({ ok: true, jobId, ...job.progress });

    for (const client of job.sseClients) {
        try {
            // Send AS BOTH named event (for addEventListener) AND unnamed event (for onmessage)
            client.res.write(`event: progress\ndata: ${payload}\n\n`);
            client.res.write(`data: ${payload}\n\n`);
        } catch {
            // ignore write errors; cleanup happens on close
        }
    }
}

function addSseClient(jobId, res) {
    const job = jobs.get(jobId);
    if (!job) return () => {};

    const client = { res };
    job.sseClients.add(client);

    // send initial snapshot immediately (both named and unnamed)
    const payload = JSON.stringify({ ok: true, jobId, ...job.progress });
    res.write(`event: progress\ndata: ${payload}\n\n`);
    res.write(`data: ${payload}\n\n`);

    const cleanup = () => {
        job.sseClients.delete(client);
    };

    res.on('close', cleanup);
    res.on('finish', cleanup);

    return cleanup;
}

module.exports = {
    createJob,
    getJob,
    deleteJob,
    setJobProgress,
    addSseClient
};