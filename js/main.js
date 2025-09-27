// Main application logic
import { elements, setStatus, setupFileInput, createDownloadLink, disableButton } from './modules/ui.js';
import { initDB, saveToIndexedDB, getFromIndexedDB } from './modules/database.js';
import { approximateVocalIsolation } from './modules/audioProcessor.js';
import { FFmpegHandler } from './modules/ffmpegHandler.js';
import { loadTranscriber, transcribeAudioBlob } from './modules/transcriber.js';
import { createFFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.0/dist/ffmpeg.min.js';

let ffmpegHandler;
let latestAudioBlob = null;
let latestTranscriptText = "";

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