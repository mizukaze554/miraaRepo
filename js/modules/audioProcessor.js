// Audio processing and vocal isolation functionality
export function floatTo16BitPCM(float32Array) {
  const l = float32Array.length;
  const buffer = new ArrayBuffer(l * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < l; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function encodeWAV(samples, sampleRate, numChannels = 1) {
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  const pcm = floatTo16BitPCM(samples);
  for (let i = 0; i < pcm.length; i++) view.setUint8(44 + i, pcm[i]);

  return new Blob([view], { type: 'audio/wav' });
}

export async function approximateVocalIsolation(wavArrayBuffer, setStatus) {
  setStatus("Decoding audio for vocal isolation...", 40);
  const audioCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 1, 44100);
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ctx.decodeAudioData(wavArrayBuffer.slice(0));
  
  if (decoded.numberOfChannels < 2) {
    setStatus("Audio is mono — skipping isolation.", 45);
    return wavArrayBuffer;
  }
  
  const left = decoded.getChannelData(0);
  const right = decoded.getChannelData(1);
  const len = Math.min(left.length, right.length);
  const out = new Float32Array(len);
  
  for (let i = 0; i < len; i++) {
    out[i] = (left[i] - right[i]) * 0.5;
  }
  
  const sr = decoded.sampleRate || 44100;
  const wavBlob = encodeWAV(out, sr, 1);
  const arr = await wavBlob.arrayBuffer();
  setStatus("Vocal isolation complete.", 48);
  
  try { ctx.close(); } catch(e) {}
  return arr;
}