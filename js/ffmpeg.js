// Import FFmpeg from CDN with proper CORS and MIME types
const FFmpeg = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.7/dist/esm/index.js');
const FFmpegCore = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.4/dist/esm/index.js');

export const { createFFmpeg, fetchFile } = FFmpeg;