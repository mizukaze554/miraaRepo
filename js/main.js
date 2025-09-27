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
  const segmentsContainer = document.getElementById('segments');
  const subtitleEl = document.getElementById('subtitle');

  let selectedFile = null;
  let audioBlobUrl = null;
  let transcriptText = '—';
  let segments = []; // {index, start, duration}
  let currentSegment = null;
  let lastTranscriptWords = []; // words array for sync

  const setStatus = (text, extraClass = '') => {
    statusEl.textContent = text;
    statusEl.className = 'text-sm font-medium px-3 py-1 rounded-full bg-gray-100 text-gray-600';
    if (extraClass) statusEl.classList.add(extraClass);
  };
  const setProgress = p => { progEl.style.width = `${p}%`; };

  // compute segments once preview metadata is available
  function computeSegments(duration) {
    const segs = [];
    const segLen = 10;
    const count = Math.ceil(duration / segLen);
    for (let i = 0; i < count; i++) {
      const start = i * segLen;
      const dur = Math.min(segLen, Math.max(0, duration - start));
      segs.push({ index: i + 1, start, duration: dur });
    }
    segments = segs;
    renderSegments();
  }

  function renderSegments() {
    segmentsContainer.innerHTML = '';
    segments.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'px-3 py-1 bg-gray-100 rounded text-sm';
      btn.textContent = `Segment ${s.index} (${s.start}s–${s.start + s.duration}s)`;
      btn.onclick = () => playSegment(s.index - 1);
      const tbtn = document.createElement('button');
      tbtn.className = 'ml-2 px-2 py-1 bg-blue-600 text-white rounded text-sm';
      tbtn.textContent = 'Transcribe';
      tbtn.onclick = (ev) => { ev.stopPropagation(); transcribeSegment(s.index - 1); };
      const container = document.createElement('div');
      container.className = 'flex items-center';
      container.appendChild(btn);
      container.appendChild(tbtn);
      segmentsContainer.appendChild(container);
    });
  }

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

    // when metadata available compute segments
    preview.addEventListener('loadedmetadata', function onMeta() {
      preview.removeEventListener('loadedmetadata', onMeta);
      computeSegments(preview.duration || (selectedFile.duration || 0));
    });
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
    // don't use muted=true here — some browsers won't expose audio tracks when muted.
    // keep the audio silent by setting volume to 0 but leaving muted false so captureStream sees audio.
    v.muted = false;
    v.volume = 0;
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

    // Start playback first so captureStream will include audio tracks on most browsers
    try {
      await v.play();
    } catch (err) {
      v.remove();
      URL.revokeObjectURL(fileUrl);
      throw err;
    }
    
    let stream;
    try {
      stream = v.captureStream();
    } catch (err) {
      // older browsers: try captureStream with fallback
      stream = v.mozCaptureStream ? v.mozCaptureStream() : null;
      if (!stream) {
        v.pause();
        v.remove();
        URL.revokeObjectURL(fileUrl);
        throw new Error('captureStream not supported in this browser');
      }
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
      v.pause();
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

  // New: extract only a time range [start, start+duration) from the file
  async function extractAudioSegment(file, startSec, durSec) {
    // similar to extractAudioFromVideo but seek and record only durSec
    setStatus(`Preparing segment ${startSec}s…`);
    setProgress(5);
    const fileUrl = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.style.display = 'none';
    v.muted = false;
    v.volume = 0;
    v.playsInline = true;
    v.src = fileUrl;
    document.body.appendChild(v);

    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Video load timeout')), 10000);
      v.addEventListener('loadedmetadata', () => { clearTimeout(t); res(); }, { once: true });
      v.addEventListener('error', (e) => { clearTimeout(t); rej(new Error('Video load error')); }, { once: true });
    });

    // seek to start
    await new Promise((res, rej) => {
      const onSeek = () => { v.removeEventListener('seeked', onSeek); res(); };
      v.addEventListener('seeked', onSeek);
      try { v.currentTime = Math.min(startSec, Math.max(0, v.duration - 0.001)); } catch (e) { res(); }
      // safety timeout
      setTimeout(res, 2000);
    });

    // play and capture
    try { await v.play(); } catch (err) { v.remove(); URL.revokeObjectURL(fileUrl); throw err; }
    let stream;
    try { stream = v.captureStream(); } catch (err) {
      stream = v.mozCaptureStream ? v.mozCaptureStream() : null;
      if (!stream) { v.pause(); v.remove(); URL.revokeObjectURL(fileUrl); throw new Error('captureStream not supported'); }
    }

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) {
      v.pause(); v.remove(); URL.revokeObjectURL(fileUrl); throw new Error('No audio track found in the video segment.');
    }
    const audioStream = new MediaStream(audioTracks);

    // choose audio mime
    let mimeType = '';
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
    else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
    else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';

    const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    recorder.start();
    setStatus('Recording segment audio...');
    setProgress(30);

    // stop after durSec seconds (or when video ends)
    await new Promise((res) => {
      const stopAfter = setTimeout(() => {
        try { recorder.stop(); } catch (_) {}
        res();
      }, Math.max(100, durSec * 1000));

      v.addEventListener('ended', () => {
        clearTimeout(stopAfter);
        try { recorder.stop(); } catch (_) {}
        res();
      }, { once: true });
    });

    // wait for onstop to finish collecting data
    await new Promise((res) => {
      recorder.onstop = () => res();
    });

    setProgress(60);
    setStatus('Decoding segment audio...');

    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    // convert to wav (16000 mono)
    const wavBuffer = audioBufferToWav(audioBuffer, { sampleRate: 16000 });
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

    v.pause(); v.remove(); URL.revokeObjectURL(fileUrl);
    setProgress(90); setStatus('Segment audio ready');
    return wavBlob;
  }

  // Transcribe a segment (uses dynamic transformers import). by default transcribes first segment.
  async function transcribeSegment(idx = 0) {
    if (!segments || !segments[idx]) { alert('Segment not available'); return; }
    setStatus(`Transcribing segment ${idx+1}...`);
    setProgress(10);

    try {
      const seg = segments[idx];
      const wavBlob = await extractAudioSegment(selectedFile, seg.start, seg.duration);

      // dynamic import of transformers pipeline from jsdelivr
      setStatus('Loading ASR model (may be large)...');
      setProgress(30);
      let pipelineFunc;
      try {
        const mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm');
        pipelineFunc = mod.pipeline;
      } catch (err) {
        console.warn('Transformers import failed', err);
        // fallback: show message
        const fallback = 'Automatic transcription unavailable (transformers load failed).';
        transcriptText = fallback;
        transcriptEl.textContent = fallback;
        setStatus('Transcription unavailable', 'warning');
        setProgress(100);
        return;
      }

      // model id from select
      const modelId = document.getElementById('model').value || 'Xenova/whisper-tiny';
      setStatus('Initializing ASR model...');
      const asr = await pipelineFunc('automatic-speech-recognition', modelId);
      setProgress(50);

      // the pipeline accepts File/Blob; pass wavBlob
      const res = await asr(wavBlob);
      // result may be {text: '...'} or similar
      transcriptText = (res && (res.text || res[0]?.text)) || String(res) || 'No text';
      transcriptEl.textContent = transcriptText;

      // prepare words for approximate sync
      lastTranscriptWords = transcriptText.trim().split(/\s+/).filter(Boolean);
      renderSubtitleWords(lastTranscriptWords);

      setStatus('Transcription done', 'success');
      setProgress(100);

    } catch (err) {
      console.error('Transcription error', err);
      transcriptText = 'Transcription failed: ' + (err.message || err);
      transcriptEl.textContent = transcriptText;
      setStatus('Transcription error', 'error');
      setProgress(0);
    }
  }

  // show words as spans for highlighting
  function renderSubtitleWords(words) {
    if (!words || words.length === 0) {
      subtitleEl.classList.add('hidden');
      subtitleEl.innerHTML = '';
      return;
    }
    subtitleEl.classList.remove('hidden');
    subtitleEl.innerHTML = words.map((w, i) => `<span data-word="${i}" style="opacity:0.6">${escapeHtml(w)}</span>`).join(' ');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));
  }

  // Play a specific segment in preview and show real-time highlighting
  function playSegment(idx = 0) {
    if (!segments || !segments[idx]) return;
    const seg = segments[idx];
    currentSegment = seg;
    preview.currentTime = seg.start;
    preview.play().catch(() => {});
    // ensure subtitle shown (may be already)
    if (lastTranscriptWords.length > 0) subtitleEl.classList.remove('hidden');

    // attach timeupdate handler to highlight words
    const onTime = () => {
      const t = preview.currentTime;
      if (!currentSegment) return;
      const elapsed = Math.max(0, t - currentSegment.start);
      const ratio = Math.min(1, currentSegment.duration ? (elapsed / currentSegment.duration) : 0);
      const total = lastTranscriptWords.length || 1;
      const upto = Math.floor(ratio * total);
      // update spans
      const spans = subtitleEl.querySelectorAll('span[data-word]');
      spans.forEach(s => {
        const idx = Number(s.getAttribute('data-word'));
        s.style.opacity = idx < upto ? '1' : '0.6';
        s.style.fontWeight = idx < upto ? '700' : '400';
      });
      // stop when segment ends
      if (elapsed >= currentSegment.duration - 0.01) {
        preview.pause();
        preview.removeEventListener('timeupdate', onTime);
        currentSegment = null;
      }
    };
    preview.removeEventListener('timeupdate', preview._onSegTime);
    preview._onSegTime = onTime;
    preview.addEventListener('timeupdate', onTime);
  }

  // Wire up preview end/seek cleanup
  preview.addEventListener('pause', () => {
    // hide subtitle when not playing
    // (keep visible if desired; here we keep it visible but dim)
  });

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