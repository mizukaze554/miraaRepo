import { getEls, setStatus, setProgress } from './lib/ui.js';
import { decodeAudioFromFile, extractAudioFromVideo, extractAudioSegment } from './lib/audio.js';
import { transcribeWithTransformers, loadTransformersModule } from './lib/asr.js';

document.addEventListener('DOMContentLoaded', () => {
  const els = getEls();
  const { videoInput, preview, dropZone, startBtn, downloadTranscriptBtn,
          statusEl, progEl, transcriptEl, subtitleEl } = els;

  let selectedFile = null;
  let transcriptText = '';

  let transformersModule = null;

  // -------------------------------
  // Handle video file selection
  // -------------------------------
  function handleFile(f) {
    if (!f) return;
    if (!f.type.startsWith('video/')) { 
      alert('Please select a valid video file.'); 
      return; 
    }
    selectedFile = f;
    preview.src = URL.createObjectURL(f);
    preview.classList.remove('hidden');
    setStatus('Ready');
    startBtn.disabled = false;

    preview.addEventListener('loadedmetadata', function onMeta() {
      preview.removeEventListener('loadedmetadata', onMeta);
      subtitleEl.classList.remove('hidden');
    });
  };

  videoInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor='#2563eb'; });
  dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.style.borderColor=''; });
  dropZone.addEventListener('drop', (e) => { 
    e.preventDefault(); 
    const f = e.dataTransfer.files[0]; 
    if (f) { 
      try { 
        const dt = new DataTransfer(); 
        dt.items.add(f); 
        videoInput.files = dt.files; 
      } catch(_) {}
      handleFile(f); 
    }
  });

  // -------------------------------
  // Start Button: setup transcript download
  // -------------------------------
  startBtn.addEventListener('click', () => {
    if (!selectedFile) { alert('No video selected.'); return; }

    startBtn.disabled = true;
    setStatus('Ready for subtitles. Play the video to start transcription.', 'success');
    setProgress(100);

    transcriptText = '';
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

    startBtn.disabled = false;
  });

  // -------------------------------
  // Real-time transcription while video plays
  // -------------------------------
  preview.addEventListener('play', async () => {
    try {
      if (!transformersModule) transformersModule = await loadTransformersModule();
      const modelId = (document.getElementById('model') && document.getElementById('model').value) || 'Xenova/whisper-tiny';

      setStatus('Extracting audio...', 'loading');
      const audioBuffer = await extractAudioFromVideo(selectedFile);

      setStatus('Transcribing...', 'loading');

      const chunkDuration = 5; // seconds
      const totalDuration = audioBuffer.duration;
      let currentTime = 0;

      const transcribeNextChunk = async () => {
        if (currentTime >= totalDuration || preview.paused) return;

        const segmentBlob = await extractAudioSegment(audioBuffer, currentTime, chunkDuration);

        const text = await transcribeWithTransformers(segmentBlob, modelId);
        transcriptText += (text ? text + '\n' : '');
        transcriptEl.textContent = transcriptText;

        currentTime += chunkDuration;

        if (!preview.paused && currentTime < totalDuration) {
          setTimeout(transcribeNextChunk, chunkDuration * 1000);
        }
      };

      transcribeNextChunk();

    } catch (e) {
      console.error('Transcription failed:', e);
      setStatus('Error during transcription', 'error');
    }
  });

  // Stop transcription when video pauses or ends
  preview.addEventListener('pause', () => { setStatus('Paused', 'warning'); });
  preview.addEventListener('ended', () => { setStatus('Ended', 'success'); });

});
