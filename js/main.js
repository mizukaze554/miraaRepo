// Main application logic
import { elements, setStatus, setupFileInput, createDownloadLink, disableButton } from './modules/ui.js';
import { initDB, saveToIndexedDB, getFromIndexedDB } from './modules/database.js';
import { approximateVocalIsolation } from './modules/audioProcessor.js';
import { FFmpegHandler } from './modules/ffmpegHandler.js';
import { loadTranscriber, transcribeAudioBlob } from './modules/transcriber.js';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { pipeline } from '@xenova/transformers';

let ffmpegHandler;
let latestAudioBlob = null;
let latestTranscriptText = "";

// Initialize FFmpeg
const ffmpeg = new FFmpeg();
await ffmpeg.load();

// Initialize transformers
const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');

// Initialize the application
async function init() {
  try {
    await initDB();
    ffmpegHandler = new FFmpegHandler(setStatus);
    setupFilePreview();
    setupProcessing();
  } catch (error) {
    console.error('Initialization error:', error);
    setStatus('Error initializing application. Please refresh the page.');
  }
}

function setupFilePreview() {
  setupFileInput(async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;

    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
    if (f.size > MAX_FILE_SIZE) {
      alert("File is too large. Please choose a file under 500MB.");
      elements.fileEl.value = '';
      return;
    }

    try {
      if (elements.preview.src) {
        URL.revokeObjectURL(elements.preview.src);
      }

      const url = URL.createObjectURL(f);
      elements.preview.style.display = "none";
      elements.transcriptEl.textContent = "—";

      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('Video loading timed out')), 10000);

        elements.preview.onloadeddata = () => {
          clearTimeout(timeoutId);
          resolve();
        };

        elements.preview.onerror = (e) => {
          clearTimeout(timeoutId);
          reject(new Error('Failed to load video: ' + (e.message || 'Unknown error')));
        };

        elements.preview.src = url;
      });

      elements.preview.style.display = "block";
    } catch (error) {
      console.error('Video loading error:', error);
      alert('Error loading video. Please try a different file. ' + error.message);
      if (elements.preview.src) {
        URL.revokeObjectURL(elements.preview.src);
      }
      elements.preview.src = '';
      elements.preview.style.display = "none";
      elements.fileEl.value = '';
    }
  });
}

async function processVideo() {
  const f = elements.fileEl.files?.[0];
  if (!f) {
    alert("Please choose a video file first.");
    return;
  }

  disableButton(elements.startBtn, true);
  setStatus("Starting process...", 2);
  elements.transcriptEl.textContent = "Working... (follow progress messages)";

  try {
    // Process video and extract audio
    const audioArrayBuffer = await ffmpegHandler.processVideo(f);
    if (!audioArrayBuffer || !(audioArrayBuffer instanceof ArrayBuffer || audioArrayBuffer instanceof Uint8Array)) {
      throw new Error('FFmpeg did not return audio data (output missing or invalid)');
    }

    // Vocal isolation if requested
    let processedAudioBuffer = audioArrayBuffer;
    if (elements.isolateEl.checked) {
      processedAudioBuffer = await approximateVocalIsolation(audioArrayBuffer, setStatus);
    }

    // Create audio blob and save to IndexedDB
    latestAudioBlob = new Blob([processedAudioBuffer], { type: "audio/wav" });
    const audioId = `audio_${Date.now()}`;
    
    try {
      await saveToIndexedDB('audioData', {
        id: audioId,
        fileName: f.name,
        blob: latestAudioBlob,
        timestamp: Date.now()
      });
      setupAudioDownload(audioId, f.name);
    } catch (error) {
      console.error('Error saving to IndexedDB:', error);
      setupDirectAudioDownload(f.name);
    }

    // Transcribe audio
    const transcriber = await loadTranscriber(elements.modelEl.value, setStatus);
    const text = await transcribeAudioBlob(transcriber, latestAudioBlob, elements.langEl.value, setStatus);
    latestTranscriptText = text;
    elements.transcriptEl.textContent = text || "(no text detected)";

    // Save transcript
    const transcriptId = `transcript_${Date.now()}`;
    try {
      await saveToIndexedDB('transcripts', {
        id: transcriptId,
        fileName: f.name,
        text: text,
        timestamp: Date.now()
      });
      setupTranscriptDownload(transcriptId, f.name);
    } catch (error) {
      console.error('Error saving transcript:', error);
      setupDirectTranscriptDownload(f.name);
    }

    setStatus("Done ✅", 100);
  } catch (err) {
    console.error(err);
    setStatus("Error: " + (err?.message ?? String(err)), 0);
    elements.transcriptEl.textContent = "Error — see console.";
    alert("Error occurred — check console for details.");
  } finally {
    disableButton(elements.startBtn, false);
  }
}

function setupAudioDownload(audioId, fileName) {
  disableButton(elements.downloadAudioBtn, false);
  elements.downloadAudioBtn.onclick = async () => {
    try {
      const audioData = await getFromIndexedDB('audioData', audioId);
      if (audioData) {
        createDownloadLink(audioData.blob, `${fileName.replace(/\.[^/.]+$/, "")}_audio.wav`);
      }
    } catch (error) {
      console.error('Error downloading audio:', error);
      alert('Error downloading audio. Please try processing the video again.');
    }
  };
}

function setupDirectAudioDownload(fileName) {
  disableButton(elements.downloadAudioBtn, false);
  elements.downloadAudioBtn.onclick = () => {
    createDownloadLink(latestAudioBlob, `${fileName.replace(/\.[^/.]+$/, "")}_audio.wav`);
  };
}

function setupTranscriptDownload(transcriptId, fileName) {
  disableButton(elements.downloadTranscriptBtn, false);
  elements.downloadTranscriptBtn.onclick = async () => {
    try {
      const transcriptData = await getFromIndexedDB('transcripts', transcriptId);
      if (transcriptData) {
        const blob = new Blob([transcriptData.text], { type: "text/plain;charset=utf-8" });
        createDownloadLink(blob, `${fileName.replace(/\.[^/.]+$/, "")}_transcript.txt`);
      }
    } catch (error) {
      console.error('Error downloading transcript:', error);
      alert('Error downloading transcript. Please try processing the video again.');
    }
  };
}

function setupDirectTranscriptDownload(fileName) {
  disableButton(elements.downloadTranscriptBtn, false);
  elements.downloadTranscriptBtn.onclick = () => {
    const blob = new Blob([latestTranscriptText], { type: "text/plain;charset=utf-8" });
    createDownloadLink(blob, `${fileName.replace(/\.[^/.]+$/, "")}_transcript.txt`);
  };
}

function setupProcessing() {
  elements.startBtn.addEventListener("click", processVideo);
}

// Get DOM elements
const videoInput = document.getElementById('videoFile');
const preview = document.getElementById('preview');
const startBtn = document.getElementById('startBtn');

// File upload handling
videoInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  
  // Validate file
  if (!file) return;
  
  if (!file.type.startsWith('video/')) {
    alert('Please select a valid video file');
    return;
  }

  if (file.size > 500 * 1024 * 1024) { // 500MB
    alert('File size must be less than 500MB');
    return;
  }

  // Show preview
  preview.classList.remove('hidden');
  preview.src = URL.createObjectURL(file);
  
  // Enable start button
  startBtn.disabled = false;
});

// Drag and drop handling
const dropZone = document.querySelector('.drop-zone');

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.style.borderColor = '#2563eb';
  dropZone.style.backgroundColor = 'rgba(37, 99, 235, 0.05)';
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropZone.style.borderColor = '';
  dropZone.style.backgroundColor = '';
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.style.borderColor = '';
  dropZone.style.backgroundColor = '';
  
  const file = e.dataTransfer.files[0];
  if (file) {
    videoInput.files = e.dataTransfer.files;
    const event = new Event('change');
    videoInput.dispatchEvent(event);
  }
});

// Start the application
(async () => {
  try {
    await initDB();
    await init();
  } catch (error) {
    console.error('Application initialization error:', error);
    setStatus('Error initializing application. Please refresh the page.');
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const videoInput = document.getElementById('videoFile');
  const preview = document.getElementById('preview');
  const dropZone = document.querySelector('.drop-zone');
  const startBtn = document.getElementById('startBtn');
  const downloadAudioBtn = document.getElementById('downloadAudio');
  const downloadTranscriptBtn = document.getElementById('downloadTranscript');
  const statusEl = document.getElementById('status');
  const progEl = document.getElementById('prog');
  const transcriptEl = document.getElementById('transcript');

  let selectedFile = null;
  let audioBlobUrl = null;
  let transcriptText = '—';

  // Helpers
  const setStatus = (text, className = '') => {
    statusEl.textContent = text;
    statusEl.className = 'text-sm font-medium px-3 py-1 rounded-full bg-gray-100 text-gray-600';
    if (className) statusEl.classList.add(className);
  };
  const setProgress = (percent) => { progEl.style.width = `${percent}%`; };

  // File validation and preview
  const handleFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      alert('Please select a valid video file.');
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      alert('File size must be less than 500MB.');
      return;
    }

    selectedFile = file;
    // show preview
    preview.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');
    setStatus('Ready');
    startBtn.disabled = false;
  };

  // Input change
  videoInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    handleFile(f);
  });

  // Drag & drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#2563eb';
    dropZone.style.backgroundColor = 'rgba(37, 99, 235, 0.05)';
  });
  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '';
    dropZone.style.backgroundColor = '';
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '';
    dropZone.style.backgroundColor = '';
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) {
      // push file into input.files for consistency
      try {
        const dt = new DataTransfer();
        dt.items.add(f);
        videoInput.files = dt.files;
      } catch (err) {
        // fallback: leave input alone
      }
      handleFile(f);
    }
  });

  // Disable downloads until available
  downloadAudioBtn.disabled = true;
  downloadTranscriptBtn.disabled = true;
  startBtn.disabled = true;

  // Start processing: dynamically import ffmpeg when needed
  startBtn.addEventListener('click', async () => {
    if (!selectedFile) {
      alert('No video selected.');
      return;
    }

    // UI guard
    startBtn.disabled = true;
    setStatus('Loading ffmpeg...', 'loading');
    setProgress(5);

    try {
      // dynamic import uses importmap mapping in index.html
      const { createFFmpeg, fetchFile } = await import('@ffmpeg/ffmpeg');
      // explicitly point corePath to unpkg to avoid jsdelivr MIME issues
      const ffmpeg = createFFmpeg({
        log: true,
        corePath: 'https://unpkg.com/@ffmpeg/core@0.12.7/dist/ffmpeg-core.js'
      });

      setStatus('Initializing ffmpeg...');
      await ffmpeg.load();
      setProgress(20);

      // write file
      setStatus('Loading video into ffmpeg filesystem...');
      const data = await fetchFile(selectedFile);
      ffmpeg.FS('writeFile', 'input_video', data);
      setProgress(35);

      // extract audio to WAV (16k sample) - suitable for offline ASR later
      setStatus('Extracting audio...');
      // remove existing output if any
      try { ffmpeg.FS('unlink', 'output.wav'); } catch (e) {}
      await ffmpeg.run('-i', 'input_video', '-vn', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', 'output.wav');
      setProgress(75);

      // read result and create blob url
      const audioData = ffmpeg.FS('readFile', 'output.wav');
      const audioBlob = new Blob([audioData.buffer], { type: 'audio/wav' });
      if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
      audioBlobUrl = URL.createObjectURL(audioBlob);

      // enable audio download button
      downloadAudioBtn.disabled = false;
      downloadAudioBtn.addEventListener('click', (ev) => {
        // download as .wav
        const a = document.createElement('a');
        a.href = audioBlobUrl;
        a.download = (selectedFile && selectedFile.name ? selectedFile.name.replace(/\.[^/.]+$/, '') : 'audio') + '.wav';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, { once: true });

      // Minimal transcript placeholder — actual ASR (Transformers) can be added later
      transcriptText = 'Audio extracted. Run ASR (transformers) to generate transcription in-browser. (Not executed automatically.)';
      transcriptEl.textContent = transcriptText;
      downloadTranscriptBtn.disabled = false;
      downloadTranscriptBtn.addEventListener('click', (ev) => {
        const blob = new Blob([transcriptText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (selectedFile && selectedFile.name ? selectedFile.name.replace(/\.[^/.]+$/, '') : 'transcript') + '.txt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }, { once: true });

      setProgress(100);
      setStatus('Done', 'success');
    } catch (err) {
      console.error('Processing error:', err);
      alert('An error occurred while processing. See console for details.');
      setStatus('Error', 'error');
      setProgress(0);
    } finally {
      startBtn.disabled = false;
    }
  });
});