export async function decodeAudioFromFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  try {
    const realCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (realCtx.state === 'suspended') try { await realCtx.resume(); } catch (_) {}
    const audioBuffer = await new Promise((res, rej) => realCtx.decodeAudioData(arrayBuffer, res, rej));
    try { realCtx.close && realCtx.close(); } catch (_) {}
    return audioBuffer;
  } catch (err) {
    try {
      const offlineCtx = new (window.OfflineAudioContext || window.AudioContext)(1,1,16000);
      const audioBuffer = await new Promise((res, rej) => offlineCtx.decodeAudioData(arrayBuffer, res, rej));
      try { offlineCtx.close && offlineCtx.close(); } catch (_) {}
      return audioBuffer;
    } catch (_) {
      return null;
    }
  }
}

export function audioBufferToWav(buffer, opts = {}) {
  const numChannels = 1;
  const sampleRate = opts.sampleRate || 16000;
  const originalRate = buffer.sampleRate;
  // getChannelData might be a function or array (pseudo buffer)
  const channelData = buffer.getChannelData ? buffer.getChannelData(0) : buffer.getChannelData();
  const chCount = buffer.numberOfChannels || 1;

  // merge channels if necessary
  if (chCount > 1 && buffer.getChannelData) {
    const tmp = new Float32Array(channelData.length);
    for (let ch=0; ch<chCount; ch++){
      const d = buffer.getChannelData(ch);
      for (let i=0;i<d.length;i++) tmp[i]=(tmp[i]||0)+d[i]/chCount;
    }
    return floatToWavAndResample(tmp, originalRate, sampleRate);
  } else {
    return floatToWavAndResample(channelData, originalRate, sampleRate);
  }

  function floatToWavAndResample(float32Array, srcRate, dstRate) {
    let samples;
    if (srcRate === dstRate) samples = float32Array;
    else {
      const ratio = srcRate / dstRate;
      const newLen = Math.round(float32Array.length / ratio);
      samples = new Float32Array(newLen);
      for (let i=0;i<newLen;i++){
        const srcIndex = i * ratio;
        const i0 = Math.floor(srcIndex);
        const i1 = Math.min(i0+1, float32Array.length-1);
        const frac = srcIndex - i0;
        samples[i] = float32Array[i0] * (1 - frac) + float32Array[i1] * frac;
      }
    }
    const bufferLen = 44 + samples.length * 2;
    const buffer = new ArrayBuffer(bufferLen);
    const view = new DataView(buffer);
    writeString(view,0,'RIFF'); view.setUint32(4,36 + samples.length*2, true);
    writeString(view,8,'WAVE'); writeString(view,12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,numChannels,true);
    view.setUint32(24,dstRate,true); view.setUint32(28,dstRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true); view.setUint16(34,16,true);
    writeString(view,36,'data'); view.setUint32(40,samples.length*2,true);
    let offset = 44;
    for (let i=0;i<samples.length;i++,offset+=2){
      let s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }
  function writeString(view, offset, str) { for (let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)); }
}

export async function extractAudioFromVideo(file) {
  // try decode full file first
  const audioBuffer = await decodeAudioFromFile(file).catch(()=>null);
  if (audioBuffer) {
    const wavBuffer = audioBufferToWav(audioBuffer, { sampleRate: 16000 });
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }
  // fallback to captureStream approach
  const fileUrl = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.style.display='none'; v.muted=false; v.volume=0; v.playsInline=true; v.src=fileUrl;
  document.body.appendChild(v);
  await new Promise((res, rej) => {
    const t=setTimeout(()=>rej(new Error('Video load timeout')),10000);
    v.addEventListener('loadedmetadata', ()=>{clearTimeout(t); res();},{once:true});
    v.addEventListener('error', ()=>{clearTimeout(t); rej(new Error('Video load error'));},{once:true});
  });
  await v.play().catch(()=>{});
  let stream = v.captureStream ? v.captureStream() : (v.mozCaptureStream ? v.mozCaptureStream() : null);
  if (!stream) { v.pause(); v.remove(); URL.revokeObjectURL(fileUrl); throw new Error('captureStream not supported'); }
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks || audioTracks.length===0) { v.pause(); v.remove(); URL.revokeObjectURL(fileUrl); throw new Error('No audio track'); }
  const audioStream = new MediaStream(audioTracks);
  const mimeType = (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') && 'audio/webm;codecs=opus') ||
                   (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm') && 'audio/webm') ||
                   (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/ogg') && 'audio/ogg') || '';
  const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
  const chunks=[];
  recorder.ondataavailable = (e)=>{ if (e.data && e.data.size) chunks.push(e.data); };
  recorder.start();
  await new Promise((res)=>{ v.addEventListener('ended', res, {once:true}); });
  await new Promise((res)=>{ recorder.onstop = ()=>res(); try{recorder.stop()}catch(_){res();} });
  const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  const decoded = await new Promise((res, rej)=> audioCtx.decodeAudioData(arrayBuffer, res, rej));
  const wavBuffer = audioBufferToWav(decoded, { sampleRate: 16000 });
  const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
  v.pause(); v.remove(); URL.revokeObjectURL(fileUrl);
  return wavBlob;
}

export async function extractAudioSegment(file, startSec, durSec) {
  // try to decode full file and slice
  const audioBuffer = await decodeAudioFromFile(file).catch(()=>null);
  if (audioBuffer) {
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(startSec * sampleRate);
    const frameCount = Math.max(0, Math.floor(durSec * sampleRate));
    const tmp = new Float32Array(frameCount);
    for (let ch=0; ch<audioBuffer.numberOfChannels; ch++){
      const chData = audioBuffer.getChannelData(ch).subarray(startSample, startSample+frameCount);
      for (let i=0;i<chData.length;i++) tmp[i] = (tmp[i]||0) + chData[i] / audioBuffer.numberOfChannels;
    }
    const pseudo = { numberOfChannels:1, sampleRate: sampleRate, getChannelData: ()=>tmp };
    const wavBuffer = audioBufferToWav(pseudo, { sampleRate: 16000 });
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }
  // fallback: use video capture and record durSec seconds
  const fileUrl = URL.createObjectURL(file);
  const v = document.createElement('video'); v.style.display='none'; v.muted=false; v.volume=0; v.playsInline=true; v.src=fileUrl; document.body.appendChild(v);
  await new Promise((res,rej)=>{ const t=setTimeout(()=>rej(new Error('Video load timeout')),10000); v.addEventListener('loadedmetadata', ()=>{clearTimeout(t); res();},{once:true}); v.addEventListener('error', ()=>{clearTimeout(t); rej(new Error('Video load error'));},{once:true}); });
  await new Promise((res)=>{ const onSeek=()=>{v.removeEventListener('seeked',onSeek); res();}; v.addEventListener('seeked', onSeek); try{ v.currentTime = Math.min(startSec, Math.max(0, v.duration - 0.001)); } catch(e){ res(); } setTimeout(res,2000); });
  await v.play().catch(()=>{});
  let stream = v.captureStream ? v.captureStream() : (v.mozCaptureStream ? v.mozCaptureStream() : null);
  if (!stream) { v.pause(); v.remove(); URL.revokeObjectURL(fileUrl); throw new Error('captureStream not supported'); }
  const audioTracks = stream.getAudioTracks(); if (!audioTracks || audioTracks.length===0) { v.pause(); v.remove(); URL.revokeObjectURL(fileUrl); throw new Error('No audio track'); }
  const audioStream = new MediaStream(audioTracks);
  const mimeType = (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') && 'audio/webm;codecs=opus') ||
                   (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm') && 'audio/webm') ||
                   (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/ogg') && 'audio/ogg') || '';
  const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
  const chunks=[];
  recorder.ondataavailable=(e)=>{ if(e.data && e.data.size) chunks.push(e.data); };
  recorder.start();
  await new Promise((res)=>{ const stopAfter = setTimeout(()=>{ try{ recorder.stop(); } catch(_){}; res(); }, Math.max(100, durSec*1000)); v.addEventListener('ended', ()=>{ clearTimeout(stopAfter); try{ recorder.stop(); } catch(_){}; res(); }, {once:true}); });
  await new Promise((res)=>{ recorder.onstop=()=>res(); });
  const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state==='suspended') await audioCtx.resume();
  const decoded = await new Promise((res, rej)=> audioCtx.decodeAudioData(arrayBuffer, res, rej));
  const wavBuffer = audioBufferToWav(decoded, { sampleRate: 16000 });
  const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
  v.pause(); v.remove(); URL.revokeObjectURL(fileUrl);
  return wavBlob;
}
