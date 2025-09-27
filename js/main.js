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

  // NEW helper: decode audio from file using AudioContext.decodeAudioData
  async function decodeAudioFromFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new (window.OfflineAudioContext || window.AudioContext || window.webkitAudioContext)(1, 1, 16000);
    try {
      // Try decodeAudioData on a real AudioContext (not Offline) for wider support
      const realCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (realCtx.state === 'suspended') {
        try { await realCtx.resume(); } catch (_) {}
      }
      const audioBuffer = await new Promise((resolve, reject) => {
        realCtx.decodeAudioData(arrayBuffer, resolve, reject);
      });
      try { realCtx.close && realCtx.close(); } catch (_) {}
      return audioBuffer;
    } catch (err) {
      // decoding failed (common for some mp4 containers), try OfflineAudioContext fallback
      try {
        const offlineCtx = new (window.OfflineAudioContext || window.AudioContext)(1, 1, 16000);
        const audioBuffer = await new Promise((resolve, reject) => {
          offlineCtx.decodeAudioData(arrayBuffer, resolve, reject);
        });
        try { offlineCtx.close && offlineCtx.close(); } catch (_) {}
        return audioBuffer;
      } catch (err2) {
        // give up decodeAudioData
        return null;
      }
    }
  }

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

  // Extract audio via preferred decode path; fallback to captureStream if decode fails
  async function extractAudioFromVideo(file) {
    setStatus('Preparing audio extraction...');
    setProgress(5);

    // Try decoding directly from file
    let audioBuffer = null;
    try {
      audioBuffer = await decodeAudioFromFile(file);
    } catch (err) {
      console.warn('decodeAudioFromFile failed', err);
      audioBuffer = null;
    }

    if (audioBuffer) {
      // Use decoded audio buffer -> WAV
      setStatus('Decoding succeeded (direct). Converting to WAV...');
      setProgress(40);
      const wavBuffer = audioBufferToWav(audioBuffer, { sampleRate: 16000 });
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      setProgress(100);
      setStatus('Audio ready (decoded)', 'success');
      return wavBlob;
    }

    // Fallback: captureStream + MediaRecorder (existing approach)
    setStatus('Direct decode failed — falling back to captureStream.');
    setProgress(10);

    const fileUrl = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.style.display = 'none';
    v.muted = false;
    v.volume = 0;
    v.playsInline = true;
    v.src = fileUrl;
    document.body.appendChild(v);

    // wait metadata
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Video load timeout')), 10000);
      v.addEventListener('loadedmetadata', () => { clearTimeout(t); res(); }, { once: true });
      v.addEventListener('error', (e) => { clearTimeout(t); rej(new Error('Video load error')); }, { once: true });
    });

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
      stream = v.mozCaptureStream ? v.mozCaptureStream() : null;
      if (!stream) {
        v.pause();
        v.remove();
        URL.revokeObjectURL(fileUrl);
        throw new Error('captureStream not supported in this browser');
      }
    }

    // use audio tracks only
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) {
      v.pause();
      v.remove();
      URL.revokeObjectURL(fileUrl);
      throw new Error('No audio track found in the video.');
    }
    const audioStream = new MediaStream(audioTracks);

    // pick a supported audio mime type
    let mimeType = '';
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')) {
      mimeType = 'audio/webm';
    } else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/ogg')) {
      mimeType = 'audio/ogg';
    }

    const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    setStatus('Recording audio from video (fallback)...');
    setProgress(25);
    recorder.start();

    // Wait until video ends
    await new Promise((res, rej) => {
      v.addEventListener('ended', res, { once: true });
      v.addEventListener('error', (e) => rej(new Error('Playback error')), { once: true });
    });

    // stop and wait for final chunks
    await new Promise((res) => {
      recorder.onstop = () => res();
      try { recorder.stop(); } catch (_) { res(); }
    });

    setProgress(60);
    setStatus('Decoding recorded audio (fallback)...');

    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const decoded = await new Promise((resolve, reject) => {
      audioCtx.decodeAudioData(arrayBuffer, resolve, reject);
    });

    const wavBuffer = audioBufferToWav(decoded, { sampleRate: 16000 });
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

    // cleanup
    v.pause();
    v.remove();
    URL.revokeObjectURL(fileUrl);

    setProgress(100);
    setStatus('Audio ready (fallback)', 'success');
    return wavBlob;
  }

  // New: extract only a time range [start, start+duration) from the file
  async function extractAudioSegment(file, startSec, durSec) {
    setStatus(`Preparing segment ${startSec}s…`);
    setProgress(5);

    // Try decode entire file first and slice the audio buffer if possible
    let audioBuffer = null;
    try {
      audioBuffer = await decodeAudioFromFile(file);
    } catch (err) {
      audioBuffer = null;
    }

    if (audioBuffer) {
      // Slice channels into mono float array for the requested segment
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(startSec * sampleRate);
      const frameCount = Math.max(0, Math.floor(durSec * sampleRate));
      // merge channels to mono
      const tmp = new Float32Array(frameCount);
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        const chData = audioBuffer.getChannelData(ch).subarray(startSample, startSample + frameCount);
        for (let i = 0; i < chData.length; i++) {
          tmp[i] = (tmp[i] || 0) + chData[i] / audioBuffer.numberOfChannels;
        }
      }
      // resample & encode to WAV via audioBufferToWav helper by wrapping tmp into a pseudo-AudioBuffer-like object
      const pseudoBuffer = {
        numberOfChannels: 1,
        sampleRate: sampleRate,
        getChannelData: () => tmp
      };
      const wavBuffer = audioBufferToWav(pseudoBuffer, { sampleRate: 16000 });
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      setProgress(100);
      setStatus('Segment audio ready (decoded)', 'success');
      return wavBlob;
    }

    // Fallback: use captureStream/MediaRecorder and record durSec seconds starting at startSec
    setStatus('Direct decode failed — using captureStream fallback for segment.');
    setProgress(10);

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
    await new Promise((res) => {
      const onSeek = () => { v.removeEventListener('seeked', onSeek); res(); };
      v.addEventListener('seeked', onSeek);
      try { v.currentTime = Math.min(startSec, Math.max(0, v.duration - 0.001)); } catch (e) { res(); }
      setTimeout(res, 2000);
    });

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

    let mimeType = '';
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
    else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
    else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';

    const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    recorder.start();
    setStatus('Recording segment audio (fallback)...');
    setProgress(30);

    // stop after durSec seconds or when video ends
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

    // wait for onstop
    await new Promise((res) => { recorder.onstop = () => res(); });

    setProgress(60);
    setStatus('Decoding recorded audio (fallback)...');

    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const decoded = await new Promise((resolve, reject) => {
      audioCtx.decodeAudioData(arrayBuffer, resolve, reject);
    });

    const wavBuffer = audioBufferToWav(decoded, { sampleRate: 16000 });
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

    v.pause(); v.remove(); URL.revokeObjectURL(fileUrl);

    setProgress(100);
    setStatus('Segment audio ready (fallback)', 'success');
    return wavBlob;
  }

  // Transcribe a segment (uses dynamic transformers import). by default transcribes first segment.
  async function transcribeSegment(idx = 0) {
    if (!segments || !segments[idx]) { alert('Segment not available'); return; }
    setStatus(`Transcribing segment ${idx+1}...`);
    setProgress(10);

    function showDetailedError(message, err) {
      console.error(message, err);
      transcriptEl.innerHTML = '';
      const p = document.createElement('div');
      p.textContent = message;
      p.style.marginBottom = '8px';
      transcriptEl.appendChild(p);

      const details = document.createElement('pre');
      details.style.maxHeight = '240px';
      details.style.overflow = 'auto';
      let txt = '';
      if (err) {
        if (err.stack) txt = err.stack;
        else try { txt = JSON.stringify(err, Object.getOwnPropertyNames(err), 2); } catch (_) { txt = String(err); }
      }
      details.textContent = txt || '(no additional details)';
      transcriptEl.appendChild(details);

      const hint = document.createElement('div');
      hint.style.marginTop = '8px';
      hint.innerHTML = `<strong>Hints:</strong>
        <ul>
          <li>Check browser console for network / CSP errors.</li>
          <li>Ensure index.html CSP allows script and connect to cdn.jsdelivr.net, esm.sh, unpkg.com.</li>
          <li>Try a different browser (Chrome/Firefox) or use the Download WAV option and transcribe externally.</li>
        </ul>`;
      transcriptEl.appendChild(hint);
    }

    try {
      const seg = segments[idx];
      const wavBlob = await extractAudioSegment(selectedFile, seg.start, seg.duration);

      // Robust dynamic loader: try multiple ESM/CDN endpoints (including +esm variants)
      setStatus('Loading ASR module (may be large)...');
      setProgress(25);

      async function loadTransformersModule() {
        // Try ESM first (preferred)
        const esmCandidates = [
          'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm',
          'https://esm.sh/@xenova/transformers@2.17.2',
          'https://unpkg.com/@xenova/transformers@2.17.2/+esm'
        ];
        let lastErr = null;
        for (const url of esmCandidates) {
          try {
            console.log('[Miraa] attempting ESM import:', url);
            const mod = await import(/* @vite-ignore */ url);
            console.log('[Miraa] ESM import succeeded for', url, 'exports:', Object.keys(mod || {}));
            if (mod && (mod.pipeline || (mod.default && mod.default.pipeline))) return mod;
            if (mod && mod.default && typeof mod.default === 'object' && mod.default.pipeline) return mod.default;
            lastErr = new Error('ESM module loaded but pipeline export not found: ' + url + ' — exports: ' + Object.keys(mod || {}).join(','));
          } catch (err) {
            lastErr = err;
            console.warn('[Miraa] ESM import failed for', url, err && err.message);
          }
        }

        // If ESM failed, try injecting a UMD/UMD-like script and wait for a global.
        const umdCandidates = [
          'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js',
          'https://unpkg.com/@xenova/transformers@2.17.2/dist/transformers.min.js'
        ];
        for (const url of umdCandidates) {
          try {
            console.log('[Miraa] attempting UMD script injection:', url);
            await new Promise((res, rej) => {
              // If already loaded, resolve immediately
              if (window.transformers || window.Transformers || window.xenovaTransformers) return res();
              const s = document.createElement('script');
              s.src = url;
              s.async = true;
              s.onload = () => setTimeout(res, 50); // slight delay to allow global to initialize
              s.onerror = (e) => rej(new Error('Script load error: ' + url));
              document.head.appendChild(s);
              // safety timeout
              setTimeout(() => rej(new Error('Script load timeout: ' + url)), 20000);
            });
            // attempt to find pipeline on known globals
            const globalMod = window.transformers || window.Transformers || window.xenovaTransformers || window['@xenova/transformers'] || null;
            if (globalMod) {
              console.log('[Miraa] found global transformers object after script injection:', Object.keys(globalMod || {}));
              // If the global itself is the pipeline factory
              if (typeof globalMod.pipeline === 'function') return globalMod;
              // Some UMD builds may set a default property
              if (globalMod.default && typeof globalMod.default.pipeline === 'function') return globalMod.default;
              lastErr = new Error('UMD script loaded but pipeline not found on global: ' + url + ' — keys: ' + Object.keys(globalMod || {}).join(','));
              continue;
            } else {
              lastErr = new Error('UMD script loaded but no known global was found: ' + url);
            }
          } catch (err) {
            lastErr = err;
            console.warn('[Miraa] UMD injection failed for', url, err && err.message);
          }
        }
        throw lastErr || new Error('No transformers module available');
      }

      let pipelineMod;
      try {
        pipelineMod = await loadTransformersModule();
      } catch (err) {
        showDetailedError('All transformer imports failed. See details below.', err);
        setStatus('Transcription unavailable', 'warning');
        setProgress(100);

        // provide download link to wavBlob as a convenience
        const url = URL.createObjectURL(wavBlob);
        const dl = document.createElement('a');
        dl.href = url;
        dl.download = `segment-${seg.index || idx+1}.wav`;
        dl.textContent = 'Download segment WAV';
        dl.style.display = 'inline-block';
        dl.style.marginTop = '8px';
        transcriptEl.appendChild(dl);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }

      // Ensure pipeline func is available
      const pipelineFunc = pipelineMod.pipeline || (pipelineMod.default && pipelineMod.default.pipeline);
      if (!pipelineFunc) {
        showDetailedError('Loaded module does not expose a pipeline() function. Module exports: ' + Object.keys(pipelineMod || {}).join(','), pipelineMod);
        setStatus('Transcription unavailable', 'warning');
        setProgress(100);
        return;
      }

      // model id from select
      const modelId = document.getElementById('model').value || 'Xenova/whisper-tiny';
      setStatus('Initializing ASR model...');
      setProgress(50);

      let asr;
      try {
        const progressCallback = (p) => { console.log('[Miraa] model load progress:', p); };
        asr = await pipelineFunc('automatic-speech-recognition', modelId, { progress_callback: progressCallback });
      } catch (err) {
        showDetailedError('Failed to initialize pipeline for model: ' + modelId, err);
        setStatus('Model init failed', 'error');
        setProgress(0);
        return;
      }

      setProgress(65);
      setStatus('Running ASR on segment...');

      let res;
      try {
        res = await asr(wavBlob);
      } catch (err) {
        showDetailedError('ASR pipeline execution failed', err);
        setStatus('ASR failed', 'error');
        setProgress(0);
        return;
      }
      console.log('ASR result:', res);

      // Extract text from various possible response shapes
      let text = '';
      if (!res) {
        text = '';
      } else if (typeof res === 'string') {
        text = res;
      } else if (typeof res === 'object') {
        if (res.text) text = res.text;
        else if (res.generated_text) text = res.generated_text;
        else if (Array.isArray(res) && res.length) {
          text = res.map(r => (r && (r.text || r.generated_text || ''))).join(' ').trim();
        } else {
          try { text = JSON.stringify(res); } catch (_) { text = String(res); }
        }
      }

      transcriptText = (text && text.trim()) || '';
      if (!transcriptText) {
        transcriptText = '[Model returned no transcript]';
        setStatus('No text returned', 'warning');
      } else {
        setStatus('Transcription done', 'success');
      }

      transcriptEl.textContent = transcriptText;

      lastTranscriptWords = transcriptText.trim().split(/\s+/).filter(Boolean);
      renderSubtitleWords(lastTranscriptWords);

      playSegment(idx);
      setProgress(100);
    } catch (err) {
      console.error('Transcription error (outer):', err);
      transcriptText = 'Transcription failed: ' + (err.message || err);
      transcriptEl.textContent = transcriptText;
      setStatus('Transcription error', 'error');
      setProgress(0);
    }
  }

  // New: microphone-based transcription fallback
  async function tryLiveMicTranscribe(wavBlob, seg) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('SpeechRecognition API not available in this browser.');
      return;
    }

    setStatus('Starting microphone transcription (allow microphone, play audio)...', 'loading');
    setProgress(5);

    const url = URL.createObjectURL(wavBlob);
    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    audio.volume = 1; // user will likely hear audio; warn via UI
    audio.playbackRate = 1.0;

    const recognition = new SpeechRecognition();
    // set language from UI if possible
    const langSelect = document.getElementById('lang');
    try { recognition.lang = (langSelect && langSelect.value) || 'en-US'; } catch (_) {}
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let finalText = '';
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript + ' ';
        }
      }
    };

    recognition.onerror = (ev) => {
      console.warn('SpeechRecognition error', ev);
    };

    const cleanup = () => {
      try { recognition.stop(); } catch (_) {}
      audio.pause();
      URL.revokeObjectURL(url);
    };

    // Start recognition then play audio so mic captures playback
    try {
      recognition.start();
    } catch (err) {
      console.warn('recognition.start failed', err);
      alert('Could not start SpeechRecognition. Check microphone permission.');
      cleanup();
      setStatus('Microphone transcription failed', 'error');
      return;
    }

    // If user permission is required, the browser will prompt.
    // Play audio; user must have speakers enabled so mic can pick it up.
    try {
      await audio.play();
    } catch (err) {
      console.warn('audio.play failed', err);
      // proceed but recognition may capture nothing
    }

    setStatus('Listening via microphone while audio plays...', 'loading');
    setProgress(30);

    // Wait until audio ends or recognition ends
    await new Promise((res) => {
      let ended = false;
      const onAudioEnd = () => { ended = true; res(); };
      audio.addEventListener('ended', onAudioEnd, { once: true });

      // recognition.onend may fire earlier; watch both
      recognition.onend = () => {
        if (!ended) {
          // if recognition stops early, stop audio as well
          try { audio.pause(); } catch (_) {}
          res();
        } else {
          res();
        }
      };
      // safety timeout (e.g., long segments)
      setTimeout(() => res(), (seg && seg.duration ? Math.ceil(seg.duration) : 10) * 1000 + 5000);
    });

    // finalize
    try { recognition.stop(); } catch (_) {}
    setProgress(70);
    setStatus('Processing microphone results...', 'loading');

    // small delay to ensure final events processed
    await new Promise(r => setTimeout(r, 500));

    // show results
    if (finalText && finalText.trim()) {
      transcriptText = finalText.trim();
      transcriptEl.textContent = transcriptText;
      lastTranscriptWords = transcriptText.split(/\s+/).filter(Boolean);
      renderSubtitleWords(lastTranscriptWords);
      // autoplay segment preview with subtitle sync
      playSegment( (seg && seg.index ? seg.index - 1 : 0) );
      setStatus('Microphone transcription done', 'success');
      setProgress(100);
    } else {
      transcriptText = '[Microphone transcription returned no text]';
      transcriptEl.textContent = transcriptText;
      setStatus('No text from microphone', 'warning');
      setProgress(0);
    }

    cleanup();
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
      transcriptText = 'Audio extracted. Starting automatic transcription for first segment...';
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
      // Auto-transcribe first segment (compute segments if missing)
      try {
        if (!segments || segments.length === 0) {
          // ensure we have metadata; compute from preview.duration if available
          const dur = preview.duration && isFinite(preview.duration) ? preview.duration : null;
          if (dur) computeSegments(dur);
        }
        if (segments && segments.length > 0) {
          setStatus('Auto-transcribing first segment...', 'loading');
          setProgress(5);
          await transcribeSegment(0);
        } else {
          // no segments available; leave placeholder
          setStatus('Ready (no segments)', 'warning');
        }
      } catch (autoErr) {
        console.warn('Auto-transcription failed', autoErr);
        setStatus('Auto-transcription failed', 'error');
      }
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