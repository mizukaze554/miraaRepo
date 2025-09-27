// FFmpeg operations and video processing
export class FFmpegHandler {
  constructor(createFFmpeg, fetchFile, setStatus) {
    this.createFFmpeg = createFFmpeg;
    this.fetchFile = fetchFile;
    this.setStatus = setStatus;
    this.ffmpeg = null;
    this.tempFiles = [];
  }

  async init() {
    this.ffmpeg = this.createFFmpeg({
      log: true,
      progress: ({ ratio }) => {
        this.setStatus("ffmpeg processing...", Math.round(8 + ratio * 20));
      }
    });
  }

  async ensureLoaded() {
    if (!this.ffmpeg) {
      await this.init();
    }
    if (!this.ffmpeg.isLoaded()) {
      this.setStatus("Loading ffmpeg core (wasm) — this may take a few seconds...", 10);
      await this.ffmpeg.load();
      this.setStatus("ffmpeg ready.", 15);
    }
  }

  async processVideo(videoFile, maxDuration = 7200) {
    await this.ensureLoaded();

    const inputName = "input_vid";
    const inputExt = videoFile.name.split('.').pop() || 'mp4';
    const inputFileName = `${inputName}.${inputExt}`;
    const outAudioName = "extracted.wav";

    try {
      // Convert file to buffer
      const fileData = await this.fetchFile(videoFile);
      if (!fileData || !(fileData instanceof Uint8Array)) {
        throw new Error('Invalid file data');
      }

      this.setStatus("Writing video to ffmpeg...", 18);
      this.ffmpeg.FS('writeFile', inputFileName, fileData);
      this.tempFiles.push(inputFileName);

      this.setStatus("Extracting audio via ffmpeg...", 20);
      await this.ffmpeg.run(
        "-y",
        "-i", inputFileName,
        "-t", String(maxDuration),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        outAudioName
      );
      this.tempFiles.push(outAudioName);

      const data = this.ffmpeg.FS('readFile', outAudioName);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } finally {
      // Clean up temporary files
      for (const file of this.tempFiles) {
        try {
          this.ffmpeg.FS('unlink', file);
        } catch (e) {
          console.warn('Failed to clean up file:', file, e);
        }
      }
      this.tempFiles = [];
    }
  }
}