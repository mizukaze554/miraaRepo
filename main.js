import { createFFmpeg, fetchFile } from "https://cdn.jsdelivr.net/npm/@ffmpeg.wasm/main@0.13.1/dist/ffmpeg.wasm.js";

const fileInput = document.getElementById('fileInput');
const startBtn = document.getElementById('startBtn');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const progressFill = document.getElementById('progressFill');
const player = document.getElementById('player');
const subtitlesEl = document.getElementById('subtitles');
const subtitleTime = document.getElementById('subtitleTime');

let videoFile = null;
let ffmpeg = null;
let worker = null;

function log(msg){
  const time = new Date().toLocaleTimeString();
  logEl.innerHTML += `<div>[${time}] ${msg}</div>`;
  logEl.scrollTop = logEl.scrollHeight;
}

fileInput.addEventListener('change', (e) => {
  videoFile = e.target.files?.[0] ?? null;
  if (!videoFile) return;
  player.src = URL.createObjectURL(videoFile);
  subtitlesEl.innerHTML = '';
  log('Loaded video: ' + videoFile.name);
});

startBtn.addEventListener('click', async () => {
  if (!videoFile) { alert('Please choose a video file first.'); return; }
  startBtn.disabled = true;
  try { await startTranscription(videoFile); }
  catch (err) { console.error(err); log('Error: ' + (err.message||err)); statusEl.textContent='Error'; }
  finally { startBtn.disabled = false; }
});

async function startTranscription(file){
  statusEl.textContent = 'Initializing ffmpeg...';
  if (!ffmpeg){
    ffmpeg = createFFmpeg({ 
      log: true, 
      corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg.wasm/core@0.13.2/dist/ffmpeg.wasm-core.js' 
    });
    await ffmpeg.load();
  }

  statusEl.textContent = 'Preparing worker...';
  if (!worker){
    worker = new Worker(new URL('./whisper_worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = handleWorkerMessage;
    worker.postMessage({ type: 'init', libsPath: './libs/' });
  }

  // Save video in FFmpeg FS
  statusEl.textContent = 'Saving video to virtual FS...';
  const data = await fetchFile(file);
  ffmpeg.FS('writeFile', 'input.mp4', data);
  log('Wrote input.mp4 (' + data.length + ' bytes)');

  // Video duration
  const duration = await getVideoDurationFromFile(file);
  log(`Video duration: ${duration.toFixed(2)}s`);
  const CHUNK_SECONDS = 10;
  const totalChunks = Math.ceil(duration / CHUNK_SECONDS);
  log(`Will process in ${totalChunks} chunk(s)`);

  statusEl.textContent = 'Processing chunks...';
  for (let i=0; i<totalChunks; i++){
    const start = i*CHUNK_SECONDS, end=Math.min(duration,(i+1)*CHUNK_SECONDS);
    const chunkLabel = `chunk_${i}.wav`;
    statusEl.textContent = `Extracting ${i+1}/${totalChunks}...`;

    try { ffmpeg.FS('unlink', chunkLabel); } catch(e){}
    await ffmpeg.run('-ss', String(start), '-to', String(end), '-i','input.mp4','-vn','-ac','1','-ar','16000','-f','wav', chunkLabel);
    const chunkData = ffmpeg.FS('readFile', chunkLabel);
    log(`Extracted: ${chunkLabel} (${chunkData.length} bytes)`);
    worker.postMessage({ type:'audio-chunk', index:i, start, end, bytes:chunkData.buffer }, [chunkData.buffer]);

    const progress = Math.round(((i+1)/totalChunks)*100);
    progressFill.style.width = progress+'%';
    statusEl.textContent = `Sent chunk ${i+1}/${totalChunks} to transcriber`;
  }

  statusEl.textContent = 'All chunks sent. Waiting for final results...';
}

function getVideoDurationFromFile(file){
  return new Promise((resolve,reject)=>{
    const tempVideo=document.createElement('video');
    tempVideo.preload='metadata';
    tempVideo.onloadedmetadata=()=>{ URL.revokeObjectURL(tempVideo.src); resolve(tempVideo.duration); };
    tempVideo.onerror=(e)=>reject(e);
    tempVideo.src=URL.createObjectURL(file);
  });
}

function handleWorkerMessage(ev){
  const msg=ev.data;
  if(!msg)return;
  if(msg.type==='log') log('[worker] '+msg.message);
  else if(msg.type==='partial-result') displaySubtitle(msg);
  else if(msg.type==='final'){ log('Worker finished.'); statusEl.textContent='Done'; progressFill.style.width='100%'; }
  else if(msg.type==='status') statusEl.textContent=msg.text;
}

function displaySubtitle({index,start,end,text}){
  subtitleTime.textContent = formatTime(start);
  const p = document.createElement('div');
  p.className='p-2 rounded-md bg-black/10';
  p.innerHTML = `<div class="text-xs text-[var(--muted)]">${formatTime(start)} → ${formatTime(end)}</div><div class="mt-1">${escapeHtml(text)}</div>`;
  subtitlesEl.appendChild(p);
  subtitlesEl.scrollTop = subtitlesEl.scrollHeight;
}

function formatTime(sec){
  const s=Math.floor(sec%60).toString().padStart(2,'0');
  const m=Math.floor((sec/60)%60).toString().padStart(2,'0');
  const h=Math.floor(sec/3600).toString().padStart(2,'0');
  return `${h}:${m}:${s}`;
}

function escapeHtml(s){ return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
