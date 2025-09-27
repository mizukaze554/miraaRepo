// Utility functions for byte operations
export function isValidUint8Array(data) {
  return data instanceof Uint8Array && data.length > 0;
}

export function checkBufferSize(buffer, minSize, maxSize) {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error('Invalid buffer type');
  }
  if (buffer.byteLength < minSize) {
    throw new Error(`Buffer too small: ${buffer.byteLength} bytes (minimum ${minSize} bytes)`);
  }
  if (maxSize && buffer.byteLength > maxSize) {
    throw new Error(`Buffer too large: ${buffer.byteLength} bytes (maximum ${maxSize} bytes)`);
  }
  return true;
}

export async function readFileAsBuffer(file, options = {}) {
  const { maxSize = null, chunkSize = 1024 * 1024 } = options;
  
  if (maxSize && file.size > maxSize) {
    throw new Error(`File too large: ${file.size} bytes (maximum ${maxSize} bytes)`);
  }

  if (file.size === 0) {
    throw new Error('File is empty');
  }

  // For small files, use simple arrayBuffer
  if (file.size <= chunkSize) {
    return await file.arrayBuffer();
  }

  // For large files, use streaming approach
  const chunks = [];
  let offset = 0;
  const reader = new FileReader();

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    const buffer = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(chunk);
    });
    chunks.push(new Uint8Array(buffer));
    offset += chunkSize;
  }

  // Combine chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }

  return result.buffer;
}

export function convertToUint8Array(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Array.isArray(data)) {
    return new Uint8Array(data);
  }
  throw new Error('Cannot convert data to Uint8Array');
}

export function concatUint8Arrays(arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export function createWAVHeader(sampleRate, numChannels, totalSamples) {
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = totalSamples * blockAlign;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  return new Uint8Array(header);
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}