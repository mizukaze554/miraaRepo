class FFmpeg {
  constructor(options = {}) {
    this.options = options;
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    
    try {
      // Load the core files
      await Promise.all([
        fetch('/js/ffmpeg/ffmpeg-core.js'),
        fetch('/js/ffmpeg/ffmpeg-core.wasm'),
        fetch('/js/ffmpeg/ffmpeg-core.worker.js')
      ]);
      this.loaded = true;
    } catch (error) {
      console.error('Failed to load FFmpeg:', error);
      throw error;
    }
  }

  isLoaded() {
    return this.loaded;
  }

  async run(...args) {
    if (!this.loaded) {
      await this.load();
    }
    // Implementation for run
  }

  FS(operation, ...args) {
    // Implementation for FS operations
  }
}

export function createFFmpeg(options = {}) {
  return new FFmpeg(options);
}

export async function fetchFile(file) {
  if (file instanceof Blob) {
    return new Uint8Array(await file.arrayBuffer());
  }
  const response = await fetch(file);
  return new Uint8Array(await response.arrayBuffer());
}