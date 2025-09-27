// FFmpeg operations and video processing
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

class FFmpegHandler {
  constructor() {
    this.ffmpeg = null;
    this.tempFiles = [];
    this.processingAborted = false;
    this.currentOperation = null;
  }

  async init() {
    try {
      this.ffmpeg = this.createFFmpeg({
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

  async processVideo(videoFile, maxDuration = 7200) {
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
        "-t", String(maxDuration),
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
      }, 300000); // 5 minutes timeout

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
      await this.ffmpeg.FS('writeFile', filename, data);
    } catch (error) {
      throw new Error(`Failed to write file to FFmpeg: ${error.message}`);
    }
  }

  async readFileFromFFmpeg(filename) {
    try {
      const data = await this.ffmpeg.FS('readFile', filename);
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
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
}