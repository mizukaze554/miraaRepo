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
  let segments = [];

  function computeSegments(duration) {
    const segs = []; const segLen = 10; const count = Math.ceil(duration / segLen);
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

  function playSegment(idx = 0) {
    if (!segments || !segments[idx]) return;
    const seg = segments[idx];
    preview.currentTime = seg.start;
    preview.play().catch(()=>{});
    // subtitle sync is handled by mic/asr results rendering (rendered into subtitleEl)
    // simple highlighting: split current transcript into words and highlight uniformly
    const words = (transcriptText || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return;
    subtitleEl.classList.remove('hidden');
    subtitleEl.innerHTML = words.map((w,i)=>`<span data-word="${i}" style="opacity:0.6">${w}</span>`).join(' ');
    const onTime = () => {
      const t = preview.currentTime;
      const elapsed = Math.max(0, t - seg.start);
      const ratio = Math.min(1, seg.duration ? (elapsed/seg.duration) : 0);
      const upto = Math.floor(ratio * words.length);
      const spans = subtitleEl.querySelectorAll('span[data-word]');
      spans.forEach(s=>{ const i = Number(s.getAttribute('data-word')); s.style.opacity = i < upto ? '1' : '0.6'; s.style.fontWeight = i < upto ? '700':'400';});
      if (elapsed >= seg.duration - 0.01) { preview.pause(); preview.removeEventListener('timeupdate', onTime); }
    };
    preview.removeEventListener('timeupdate', preview._onSegTime);
    preview._onSegTime = onTime;
    preview.addEventListener('timeupdate', onTime);
  }

  function handleFile(f) {
    if (!f) return;
    if (!f.type.startsWith('video/')) { alert('Please select a valid video file.'); return; }
    selectedFile = f;
    preview.src = URL.createObjectURL(f);
    preview.classList.remove('hidden');
    setStatus('Ready');
    startBtn.disabled = false;
    preview.addEventListener('loadedmetadata', function onMeta(){
      preview.removeEventListener('loadedmetadata', onMeta);
      computeSegments(preview.duration || 0);
    });
  }

  videoInput.addEventListener('change', (e)=>handleFile(e.target.files && e.target.files[0]));
  dropZone.addEventListener('dragover', (e)=>{ e.preventDefault(); dropZone.style.borderColor='#2563eb'; });
  dropZone.addEventListener('dragleave', (e)=>{ e.preventDefault(); dropZone.style.borderColor=''; });
  dropZone.addEventListener('drop', (e)=>{ e.preventDefault(); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) { try{ const dt = new DataTransfer(); dt.items.add(f); videoInput.files = dt.files; }catch(_){ } handleFile(f); }});

  // Start button: extract full audio and auto-transcribe first segment
  startBtn.addEventListener('click', async () => {
    if (!selectedFile) { alert('No video selected.'); return; }
    startBtn.disabled = true;
    setStatus('Preparing...', 'loading'); setProgress(2);
    try {
      const wavBlob = await extractAudioFromVideo(selectedFile);
      if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
      audioBlobUrl = URL.createObjectURL(wavBlob);
      downloadAudioBtn.disabled = false;
      downloadAudioBtn.onclick = ()=>{ const a=document.createElement('a'); a.href = audioBlobUrl; a.download = (selectedFile.name||'audio').replace(/\.[^/.]+$/, '') + '.wav'; document.body.appendChild(a); a.click(); a.remove(); };
      transcriptText = 'Audio extracted. Auto-transcribing first segment...';
      transcriptEl.textContent = transcriptText;
      downloadTranscriptBtn.disabled = false;
      downloadTranscriptBtn.onclick = ()=>{ const b=new Blob([transcriptText], {type:'text/plain;charset=utf-8'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=(selectedFile.name||'transcript').replace(/\.[^/.]+$/,'')+'.txt'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);};
      setProgress(100); setStatus('Done', 'success');

      // auto-transcribe first segment if available
      if (!segments || segments.length===0) {
        if (isFinite(preview.duration)) computeSegments(preview.duration);
      }
      if (segments && segments.length>0) {
        await transcribeSegment(0);
      }
    } catch (err) {
      console.error(err); alert('Processing failed. See console'); setStatus('Error','error'); setProgress(0);
    } finally { startBtn.disabled = false; }
  });

  // transcribe a specific segment
  async function transcribeSegment(idx = 0) {
    if (!segments || !segments[idx]) { alert('Segment not available'); return; }
    setStatus(`Transcribing segment ${idx+1}...`); setProgress(10);
    try {
      const seg = segments[idx];
      const wavBlob = await extractAudioSegment(selectedFile, seg.start, seg.duration);
      // try local transformers loader first
      try {
        const modelId = (document.getElementById('model') && document.getElementById('model').value) || 'Xenova/whisper-tiny';
        const text = await transcribeWithTransformers(wavBlob, modelId);
        transcriptText = (text && String(text).trim()) || '[No text]';
        transcriptEl.textContent = transcriptText;
        setStatus('Transcription done','success'); setProgress(100);
        // render words and auto-play segment with subtitles
        playSegment(idx);
      } catch (err) {
        console.warn('Transformers ASR failed, falling back to microphone method', err);
        setStatus('ASR failed — try microphone fallback', 'warning');
        // show download link and mic option
        const url = URL.createObjectURL(wavBlob);
        const dl = document.createElement('a'); dl.href=url; dl.download=`segment-${seg.index||idx+1}.wav`; dl.textContent='Download segment WAV'; dl.style.display='inline-block'; dl.style.marginRight='12px';
        transcriptEl.innerHTML = ''; transcriptEl.appendChild(dl);
        const micBtn = document.createElement('button'); micBtn.textContent='Try Microphone Transcribe'; micBtn.className='ml-2 px-3 py-1 bg-green-600 text-white rounded text-sm';
        micBtn.onclick = async ()=>{ micBtn.disabled=true; try{ await tryLiveMicTranscribe(wavBlob, seg); } finally { micBtn.disabled=false; } };
        transcriptEl.appendChild(micBtn);
      }
    } catch (err) {
      console.error(err);
      transcriptText = 'Transcription failed: ' + (err.message || err);
      transcriptEl.textContent = transcriptText;
      setStatus('Transcription error','error'); setProgress(0);
    }
  }

  // expose live control
  injectLiveControl(); // adds live mic UI if supported

});