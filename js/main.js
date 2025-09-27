import { getEls, setStatus, setProgress } from './lib/ui.js';
import { decodeAudioFromFile, extractAudioFromVideo, extractAudioSegment } from './lib/audio.js';
import { transcribeWithTransformers, loadTransformersModule } from './lib/asr.js';
import { tryLiveMicTranscribe, injectLiveControl } from './lib/mic.js';

document.addEventListener('DOMContentLoaded', () => {
  const els = getEls();
  const { videoInput, preview, dropZone, startBtn, downloadAudioBtn, downloadTranscriptBtn,
          statusEl, progEl, transcriptEl, segmentsContainer, subtitleEl } = els;

  let selectedFile = null;
  let audioBlobUrl = null;
  let transcriptText = '—';
  // segments removed — using live mic transcription while video plays
  let currentSegment = null;

  // Live recognition state
  let liveMicActive = false;
  let micStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let transformersModule = null;

  // injectLiveButton(); // Uncomment if you want to add live mic button in the UI

  // helper function to start live microphone transcription
  async function startLiveRecognition() {
    if (liveMicActive || !selectedFile) return;
    liveMicActive = true;
    transcriptText = 'Listening...';
    transcriptEl.textContent = transcriptText;

    // Request microphone access
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(micStream);

    // Create a processor to handle the audio data
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = async (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      audioChunks.push(new Float32Array(inputData));
    };

    // Use transformers for initial ASR testing
    try {
      if (!transformersModule) transformersModule = await loadTransformersModule();
      const modelId = (document.getElementById('model') && document.getElementById('model').value) || 'Xenova/whisper-tiny';
      const text = await transcribeWithTransformers(new Blob(audioChunks), modelId);
      transcriptText = (text && String(text).trim()) || '[No text]';
      transcriptEl.textContent = transcriptText;
    } catch (err) {
      console.warn('Transformers ASR failed, falling back to microphone method', err);
      transcriptEl.textContent = 'ASR failed, using fallback...';
      // Fallback to manual recording and processing
      mediaRecorder = new MediaRecorder(micStream);
      mediaRecorder.ondataavailable = async (e) => {
        audioChunks.push(e.data);
        // simple wav blob creation
        const blob = new Blob(audioChunks, { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'recording.wav';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        audioChunks = []; // reset for next recording
      };
      mediaRecorder.start();
      transcriptEl.textContent += ' (recording...)';
    }
  }

  // helper function to stop live microphone transcription
  function stopLiveRecognition() {
    if (!liveMicActive) return;
    liveMicActive = false;
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
      micStream = null;
    }
    if (mediaRecorder) {
      mediaRecorder.stop();
      mediaRecorder = null;
    }
    transcriptEl.textContent = 'Stopped.';
  }

  function handleFile(f) {
    if (!f) return;
    if (!f.type.startsWith('video/')) { alert('Please select a valid video file.'); return; }
    selectedFile = f;
    preview.src = URL.createObjectURL(f);
    preview.classList.remove('hidden');
    setStatus('Ready');
    startBtn.disabled = false;

    // when metadata available compute segments
    preview.addEventListener('loadedmetadata', function onMeta() {
      preview.removeEventListener('loadedmetadata', onMeta);
      // ensure subtitle area is visible
      subtitleEl.classList.remove('hidden');
    });
  };

  videoInput.addEventListener('change', (e)=>handleFile(e.target.files && e.target.files[0]));
  dropZone.addEventListener('dragover', (e)=>{ e.preventDefault(); dropZone.style.borderColor='#2563eb'; });
  dropZone.addEventListener('dragleave', (e)=>{ e.preventDefault(); dropZone.style.borderColor=''; });
  dropZone.addEventListener('drop', (e)=>{ e.preventDefault(); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) { try{ const dt = new DataTransfer(); dt.items.add(f); videoInput.files = dt.files; }catch(_){ } handleFile(f); }});

  // Start button: extract full audio and auto-transcribe first segment
  startBtn.addEventListener('click', async () => {
    if (!selectedFile) { alert('No video selected.'); return; }

    startBtn.disabled = true;
    setStatus('Preparing...', 'loading');
    setProgress(2);

    try {
      // For the new flow we simply enable the UI; live subtitles will appear while video plays.
      transcriptText = 'Ready for live subtitles. Play the video to start microphone-based transcription.';
      transcriptEl.textContent = transcriptText;
      downloadTranscriptBtn.disabled = false;
      downloadTranscriptBtn.onclick = () => {
        const blob = new Blob([transcriptText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (selectedFile && selectedFile.name ? selectedFile.name.replace(/\.[^/.]+$/, '') : 'transcript') + '.txt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      };
      setProgress(100);
      setStatus('Ready', 'success');
    } catch (err) {
      console.error(err);
      alert('Processing failed. See console for details.');
      setStatus('Error', 'error');
      setProgress(0);
    } finally {
      startBtn.disabled = false;
    }
  });

  // Wire up preview end/seek cleanup
  preview.addEventListener('pause', () => {
    // stop live recognition when video paused
    // hide subtitle when not playing
    // (keep visible if desired; here we keep it visible but dim)
    try { stopLiveRecognition(); } catch (_) {}
  });
  preview.addEventListener('ended', () => { try { stopLiveRecognition(); } catch (_) {} });
  preview.addEventListener('play', () => {
    // When the user plays the video, start live microphone recognition for realtime subtitles
    try { startLiveRecognition(); } catch (e) { console.warn('Live recognition start failed', e); }
  });

  // expose live control
  injectLiveControl(); // adds live mic UI if supported

  // end of DOMContentLoaded
});