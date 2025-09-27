// Import FFmpeg from ESM.sh CDN which properly handles MIME types and CORS
const ffmpegURL = 'https://esm.sh/@ffmpeg/ffmpeg@0.12.15';
const ffmpegCoreURL = 'https://esm.sh/@ffmpeg/core-mt@0.12.6';

export const { createFFmpeg, fetchFile } = await import(ffmpegURL);