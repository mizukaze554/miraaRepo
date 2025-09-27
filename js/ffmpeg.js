// Import FFmpeg from CDN with proper CORS and MIME types
const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg';
const ffmpegVersion = '0.12.7';
const coreVersion = '0.12.4';

const { createFFmpeg, fetchFile } = await import(`${baseURL}/ffmpeg@${ffmpegVersion}/dist/esm/index.js`);

// Pre-load the core module
await import(`${baseURL}/core@${coreVersion}/dist/esm/index.js`);

export { createFFmpeg, fetchFile };