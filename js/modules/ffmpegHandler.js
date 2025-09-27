// FFmpeg operations and video processing
// FFmpeg operations and video processing
// Dynamically import ffmpeg module (use version 0.12.7 as requested)
import {
  isValidUint8Array,
  checkBufferSize,
  readFileAsBuffer,
  convertToUint8Array,
  createWAVHeader
} from './byteUtils.js';

const CHUNK_SIZE = 1024 * 1024; // 1MB chunks for large files
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const MIN_FILE_SIZE = 1024; // 1KB
const MAX_DURATION = 7200; // 2 hours in seconds
const TIMEOUT_DURATION = 300000; // 5 minutes in milliseconds

export class FFmpegHandler {
  constructor(setStatusCallback) {
    this.ffmpeg = null;
    this.tempFiles = [];
    this.processingAborted = false;
    this.currentOperation = null;
    this.setStatus = setStatusCallback;
  }

  async init() {
    try {
      // Prefer global createFFmpeg (when user includes script tag in HTML)
      let createFFmpegFn = null;
      if (typeof window !== 'undefined') {
        if (typeof window.createFFmpeg === 'function') {
          createFFmpegFn = window.createFFmpeg;
        } else if (window.FFmpeg) {
          // Some UMD builds expose a global FFmpeg object, try common shapes
          if (typeof window.FFmpeg.createFFmpeg === 'function') createFFmpegFn = window.FFmpeg.createFFmpeg;
          else if (typeof window.FFmpeg === 'function') createFFmpegFn = window.FFmpeg;
        }
      }
      if (!createFFmpegFn) {
        // Fallback to dynamic import if global not present
        const ffmpegMod = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.7/dist/ffmpeg.min.js');
        createFFmpegFn = ffmpegMod.createFFmpeg ?? (ffmpegMod.default && (ffmpegMod.default.createFFmpeg ?? ffmpegMod.default));
      }
      if (!createFFmpegFn) throw new Error('Could not resolve createFFmpeg from @ffmpeg/ffmpeg module');

      this.ffmpeg = createFFmpegFn({
        log: true,
        logger: ({ type, message }) => {
          if (type === 'fferr') {
            console.warn('FFmpeg:', message);
          }
        },
        progress: ({ ratio }) => {
          if (this.processingAborted) return;
          const progress = Math.round(8 + ratio * 20);
          this.setStatus("FFmpeg processing...", progress);
        }
      });
    } catch (error) {
      throw new Error(`Failed to initialize FFmpeg: ${error.message}`);
    }
  }

  async ensureLoaded() {
    try {
      if (!this.ffmpeg) {
        await this.init();
      }
      if (!this.ffmpeg.isLoaded()) {
        this.setStatus("Loading FFmpeg core (wasm) — this may take a few seconds...", 10);
        await this.ffmpeg.load();
        this.setStatus("FFmpeg ready.", 15);
      }
    } catch (error) {
      throw new Error(`Failed to load FFmpeg: ${error.message}`);
    }
  }

  abort() {
    this.processingAborted = true;
    if (this.currentOperation) {
      this.currentOperation.abort();
    }
  }

  async processVideo(videoFile) {
    if (this.processingAborted) {
      throw new Error('Processing was aborted');
    }

    // Validate input
    if (!(videoFile instanceof File)) {
      throw new Error('Invalid input: expected File object');
    }

    try {
      checkBufferSize(await videoFile.slice(0, 8192).arrayBuffer(), 8192);
    } catch (error) {
      throw new Error(`Invalid video file: ${error.message}`);
    }

    if (videoFile.size > MAX_FILE_SIZE) {
      throw new Error(`File too large: maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    if (videoFile.size < MIN_FILE_SIZE) {
      throw new Error('File too small: might be corrupted');
    }

    await this.ensureLoaded();

    const inputName = "input_vid";
    const inputExt = videoFile.name.split('.').pop()?.toLowerCase() || 'mp4';
    const inputFileName = `${inputName}.${inputExt}`;
    const outAudioName = "extracted.wav";

    // Validate file extension
    if (!['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(inputExt)) {
      throw new Error('Unsupported video format. Please use MP4, WebM, MOV, AVI, or MKV');
    }

    try {
      // Read file in chunks for large files
      this.setStatus("Reading video file...", 16);
      const fileData = await readFileAsBuffer(videoFile, {
        maxSize: MAX_FILE_SIZE,
        chunkSize: CHUNK_SIZE
      });

      const uint8Data = convertToUint8Array(fileData);
      if (!isValidUint8Array(uint8Data)) {
        throw new Error('Failed to convert video data');
      }

      this.setStatus("Writing video to FFmpeg...", 18);
      await this.writeFileToFFmpeg(inputFileName, uint8Data);
      this.tempFiles.push(inputFileName);

      this.setStatus("Extracting audio via FFmpeg...", 20);
      
      // Configure audio extraction
      const ffmpegArgs = [
        "-y",
        "-i", inputFileName,
        "-t", String(MAX_DURATION),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        "-f", "wav",
        outAudioName
      ];

      // Run FFmpeg with timeout
      const timeout = setTimeout(() => {
        this.abort();
        throw new Error('FFmpeg operation timed out');
      }, TIMEOUT_DURATION);

      try {
        await this.ffmpeg.run(...ffmpegArgs);
      } finally {
        clearTimeout(timeout);
      }
      
      this.tempFiles.push(outAudioName);

      // Read and validate output
      const outputData = await this.readFileFromFFmpeg(outAudioName);
      if (!isValidUint8Array(outputData)) {
        throw new Error('Failed to extract audio data');
      }

      // Validate WAV header
      if (outputData.length < 44 || 
          String.fromCharCode(...outputData.slice(0, 4)) !== 'RIFF' ||
          String.fromCharCode(...outputData.slice(8, 12)) !== 'WAVE') {
        throw new Error('Invalid WAV file generated');
      }

      return outputData.buffer;
    } catch (error) {
      throw new Error(`Failed to process video: ${error.message}`);
    } finally {
      await this.cleanup();
    }
  }

  async writeFileToFFmpeg(filename, data) {
    try {
      // Ensure we pass a Uint8Array
      const bytes = (data instanceof Uint8Array) ? data : new Uint8Array(data);
      await this.ffmpeg.FS('writeFile', filename, bytes);
    } catch (error) {
      throw new Error(`Failed to write file to FFmpeg: ${error.message}`);
    }
  }

  async readFileFromFFmpeg(filename) {
    try {
      // Check existence first
      try {
        // Some ffmpeg.wasm builds provide a 'FS' API that throws if file missing
        const data = await this.ffmpeg.FS('readFile', filename);
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      } catch (e) {
        throw new Error(`FFmpeg did not produce expected output file: ${filename} — ${e.message}`);
      }
    } catch (error) {
      throw new Error(`Failed to read file from FFmpeg: ${error.message}`);
    }
  }

  async cleanup() {
    for (const file of this.tempFiles) {
      try {
        await this.ffmpeg.FS('unlink', file);
      } catch (error) {
        console.warn(`Failed to clean up file ${file}:`, error);
      }
    }
    this.tempFiles = [];
    this.processingAborted = false;
    this.currentOperation = null;
  }

  // Debug helper: try to list files in FFmpeg FS if available
  async _listFS() {
    try {
      if (!this.ffmpeg || !this.ffmpeg.FS) return null;
      const files = await this.ffmpeg.FS('readdir', '/');
      return files;
    } catch (e) {
      try { return this.ffmpeg.FS('readdir', '.'); } catch (e2) { return null; }
    }
  }
}