// Simple in-memory mapping: jobId -> produced file path + metadata.
// This is used by the frontend to download the generated file after SSE progress finishes.

const filesByJobId = new Map();

function setJobFile(jobId, { filePath, mimeType, ext, asciiFilename }) {
    filesByJobId.set(String(jobId), {
        filePath,
        mimeType,
        ext,
        asciiFilename,
        createdAt: Date.now(),
    });
}

function getJobFile(jobId) {
    return filesByJobId.get(String(jobId));
}

function deleteJobFile(jobId) {
    filesByJobId.delete(String(jobId));
}

module.exports = {
    setJobFile,
    getJobFile,
    deleteJobFile,
};