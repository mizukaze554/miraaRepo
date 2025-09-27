document.addEventListener('DOMContentLoaded', () => {
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

  const setStatus = (text, extraClass = '') => {
    statusEl.textContent = text;
    statusEl.className = 'text-sm font-medium px-3 py-1 rounded-full bg-gray-100 text-gray-600';
    if (extraClass) statusEl.classList.add(extraClass);
  };
  const setProgress = p => { progEl.style.width = `${p}%`; };

  // File validation & preview
  const handleFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) { alert('Please select a valid video file.'); return; }
    if (file.size > 500 * 1024 * 1024) { alert('File size must be less than 500MB.'); return; }

    selectedFile = file;
    preview.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');
    setStatus('Ready');
    startBtn.disabled = false;
  };

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
      try {
        const dt = new DataTransfer();
        dt.items.add(f);
        videoInput.files = dt.files;
      } catch (_) { /* ignore */ }
      handleFile(f);
    }
  });

  // Disable buttons initially
  startBtn.disabled = true;
  downloadAudioBtn.disabled = true;
  downloadTranscriptBtn.disabled = true;

  // Utility: convert AudioBuffer -> WAV (PCM16)
  function audioBufferToWav(buffer, opts = {}) {
    const numChannels = 1; // use mono for smaller size and ASR friendliness
    const sampleRate = opts.sampleRate || 16000;
    const originalRate = buffer.sampleRate;
    // Merge down to mono & resample if needed
    const channelData = buffer.getChannelData(0);
    // If more channels exist, average them
    if (buffer.numberOfChannels > 1) {
      const tmp = new Float32Array(buffer.length);
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const d = buffer.getChannelData(ch);
        for (let i = 0; i < d.length; i++) tmp[i] = (tmp[i] || 0) + d[i] / buffer.numberOfChannels;
      }
      // use tmp as mono data
      return floatToWavAndResample(tmp, originalRate, sampleRate);
    } else {
      return floatToWavAndResample(channelData, originalRate, sampleRate);
    }

    function floatToWavAndResample(float32Array, srcRate, dstRate) {
      // If same rate, skip resample
      let samples;
      if (srcRate === dstRate) {
        samples = float32Array;
      } else {
        const ratio = srcRate / dstRate;
        const newLen = Math.round(float32Array.length / ratio);
        samples = new Float32Array(newLen);
        for (let i = 0; i < newLen; i++) {
          const srcIndex = i * ratio;
          const i0 = Math.floor(srcIndex);
          const i1 = Math.min(i0 + 1, float32Array.length - 1);
          const frac = srcIndex - i0;
          samples[i] = float32Array[i0] * (1 - frac) + float32Array[i1] * frac;
        }
      }
      // PCM16 encode
      const bufferLen = 44 + samples.length * 2;
      const buffer = new ArrayBuffer(bufferLen);
      const view = new DataView(buffer);

      // WAV header
      writeString(view, 0, 'RIFF'); // chunkID
      view.setUint32(4, 36 + samples.length * 2, true); // chunkSize
      writeString(view, 8, 'WAVE'); // format
      writeString(view, 12, 'fmt '); // subchunk1ID
      view.setUint32(16, 16, true); // subchunk1Size
      view.setUint16(20, 1, true); // audioFormat (1 = PCM)
      view.setUint16(22, numChannels, true); // numChannels
      view.setUint32(24, dstRate, true); // sampleRate
      view.setUint32(28, dstRate * numChannels * 2, true); // byteRate
      view.setUint16(32, numChannels * 2, true); // blockAlign
      view.setUint16(34, 16, true); // bitsPerSample
      writeString(view, 36, 'data'); // subchunk2ID
      view.setUint32(40, samples.length * 2, true); // subchunk2Size

      // write PCM samples
      let offset = 44;
      for (let i = 0; i < samples.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }

      return buffer;
    }
    function writeString(view, offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // Extract audio via captureStream + MediaRecorder + decoding -> WAV
  async function extractAudioFromVideo(file) {
    setStatus('Preparing recording...');
    setProgress(5);

    const fileUrl = URL.createObjectURL(file);

    // create hidden video element to drive captureStream
    const v = document.createElement('video');
    v.style.display = 'none';
    v.muted = true;
    v.playsInline = true;
    v.src = fileUrl;
    document.body.appendChild(v);

    // ensure user gesture resumed audio context later
    // wait metadata
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Video load timeout')), 10000);
      v.addEventListener('loadedmetadata', () => { clearTimeout(t); res(); }, { once: true });
      v.addEventListener('error', (e) => { clearTimeout(t); rej(new Error('Video load error')); }, { once: true });
    });

    setProgress(15);
    setStatus('Starting capture...');

    // captureStream may only produce stream when video is playing; create before play
    let stream;
    try {
      stream = v.captureStream();
    } catch (err) {
      // older browsers: try captureStream with fallback
      stream = v.mozCaptureStream ? v.mozCaptureStream() : null;
      if (!stream) throw new Error('captureStream not supported in this browser');
    }

    // pick an audio mimeType supported by MediaRecorder
    let mimeType = '';
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')) {
      mimeType = 'audio/webm';
    } else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/ogg')) {
      mimeType = 'audio/ogg';
    }

    if (!mimeType) {
      // still try default
      mimeType = '';
    }

    // Use only audio tracks for MediaRecorder (video track causes "audio type" errors)
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) {
      v.remove();
      URL.revokeObjectURL(fileUrl);
      throw new Error('No audio track found in the video.');
    }
    const audioStream = new MediaStream(audioTracks);
    const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
    
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    // play and record
    setStatus('Recording audio from video...');
    setProgress(25);

    recorder.start();
    // ensure play starts (user clicked Start so gesture exists)
    await v.play().catch(err => {
      recorder.stop();
      v.remove();
      URL.revokeObjectURL(fileUrl);
      throw err;
    });

    // Wait until video ends
    await new Promise((res, rej) => {
      v.addEventListener('ended', res, { once: true });
      v.addEventListener('error', (e) => rej(new Error('Playback error')), { once: true });
      // safety: if video is very long, still wait for ended
    });

    // stop recorder, wait for final data
    await new Promise((res) => {
      recorder.onstop = () => res();
      try { recorder.stop(); } catch (_) { res(); }
    });

    setProgress(60);
    setStatus('Decoding and converting audio...');

    // combine chunks into blob and decode
    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // resume on user gesture (should be allowed)
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    // convert to WAV (PCM16) with target sampleRate 16000
    const wavBuffer = audioBufferToWav(audioBuffer, { sampleRate: 16000 });
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

    // cleanup
    v.pause();
    v.remove();
    URL.revokeObjectURL(fileUrl);

    setProgress(90);
    setStatus('Audio ready');

    return wavBlob;
  }

  // Start button handler
  startBtn.addEventListener('click', async () => {
    if (!selectedFile) { alert('No video selected.'); return; }

    startBtn.disabled = true;
    setStatus('Preparing...', 'loading');
    setProgress(2);

    try {
      // Extract audio without external libs
      const wavBlob = await extractAudioFromVideo(selectedFile);
      // create download URL
      if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
      audioBlobUrl = URL.createObjectURL(wavBlob);

      // attach download action
      downloadAudioBtn.disabled = false;
      downloadAudioBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = audioBlobUrl;
        a.download = (selectedFile && selectedFile.name ? selectedFile.name.replace(/\.[^/.]+$/, '') : 'audio') + '.wav';
        document.body.appendChild(a);
        a.click();
        a.remove();
      };

      // Minimal transcript placeholder (actual ASR integration can be added on demand)
      transcriptText = 'Audio extracted. To generate transcript, enable in-browser ASR (optional).';
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
      setStatus('Done', 'success');
    } catch (err) {
      console.error(err);
      alert('Processing failed. See console for details.');
      setStatus('Error', 'error');
      setProgress(0);
    } finally {
      startBtn.disabled = false;
    }
  });
});