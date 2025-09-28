/* whisper_worker.js
   Runs inside a WebWorker (module). Responsibilities:
   - Load whisper.wasm or other model bindings from ./libs/
   - Provide an init handshake: {type: 'init', libsPath: './libs/'}
   - Accept messages: {type: 'audio-chunk', index, start, end, bytes: ArrayBuffer}
   - Return partial transcripts as they become available:
       postMessage({ type: 'partial-result', index, start, end, text })
   - At end, postMessage({ type: 'final' })
*/

/* WARNING: The exact API to your whisper WASM may differ depending on the build you use.
   Below is a generic integration pattern that works with a whisper.cpp-wasm style build that exposes:
   - Module/wasm runtime loaded via importScripts or dynamic import
   - An initialize(modelPath) function
   - A transcribePCM(buffer) function that accepts PCM16 16k mono as ArrayBuffer and returns text

   If your WASM wrapper has a different API, adapt the calls accordingly.
*/

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === 'init') {
    self.libsPath = msg.libsPath || './libs/';
    postLog('worker init; libsPath=' + self.libsPath);
    await initWasm();
    return;
  }

  if (msg.type === 'audio-chunk') {
    // bytes is an ArrayBuffer (transferred)
    const { index, start, end, bytes } = msg;
    postLog(`Received chunk ${index} ${start}-${end} (${bytes.byteLength} bytes)`);
    // The bytes represent a WAV file (we produced WAV PCM16 16k mono using ffmpeg)
    // We need to extract PCM data (strip WAV header) or pass WAV if the model wrapper accepts it.
    // We'll strip the WAV header (44 bytes) and pass raw PCM16 LE samples
    try {
      const view = new Uint8Array(bytes);
      let pcm;
      // Very simple WAV header strip: search for 'data' chunk
      const headerStr = new TextDecoder().decode(view.subarray(0, 64));
      const idx = headerStr.indexOf('data');
      if (idx !== -1) {
        // 'data' bytes position + 8 gives start of PCM
        // Locate 'data' ASCII in the buffer
        let dataIndex = -1;
        for (let i=0;i<64;i++){
          if (view[i] === 0x64 && view[i+1] === 0x61 && view[i+2] === 0x74 && view[i+3] === 0x61) {
            dataIndex = i;
            break;
          }
        }
        if (dataIndex !== -1) {
          // data header size is 8 bytes after 'data' marker
          const pcmStart = dataIndex + 8;
          pcm = view.subarray(pcmStart);
        } else {
          pcm = view; // fallback
        }
      } else {
        pcm = view;
      }

      // For performance: pass the underlying buffer (ArrayBuffer)
      const pcmBuffer = pcm.buffer;

      // Call into model
      if (typeof self.transcribePCM === 'function') {
        postStatus('Transcribing chunk ' + index + '...');
        const text = await self.transcribePCM(pcmBuffer);
        postMessage({ type: 'partial-result', index, start, end, text });
      } else {
        // If no model loaded, fallback to a dummy result (for development)
        postLog('transcribePCM not available — returning placeholder text');
        await sleep(500);
        postMessage({ type: 'partial-result', index, start, end, text: '[model not loaded — add whisper.wasm]' });
      }
    } catch (err){
      postLog('Error processing chunk: ' + err);
    }
  }
};

// Helper sleep
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function postLog(m){ self.postMessage({ type: 'log', message: m }); }
function postStatus(t){ self.postMessage({ type: 'status', text: t }); }

// Initialize WASM model — adapt to your WASM wrapper!
async function initWasm(){
  postLog('Initializing WASM model (generic loader). Looking for model in ' + self.libsPath);

  // Example strategy: try to import a wrapper script that sets up `transcribePCM`
  // You may have a script like libs/whisper.js that when imported registers functions on "self"
  try {
    // try to import a wrapper if it exists
    try {
      importScripts(self.libsPath + 'whisper.js');
      postLog('Imported whisper.js from libs/');
    } catch (e) {
      postLog('No whisper.js wrapper found (okay if you load wasm differently). ' + e);
    }

    // If whisper.js provided an async init function named "whisperInit" and "whisperTranscribePCM"
    if (typeof self.whisperInit === 'function') {
      postLog('Found whisperInit(); initializing model...');
      await self.whisperInit(self.libsPath); // e.g. whisperInit('/libs/')
      // Assume whisperTranscribePCM exists -> map to transcribePCM
      if (typeof self.whisperTranscribePCM === 'function') {
        self.transcribePCM = async (pcmBuffer) => {
          // whisperTranscribePCM should accept ArrayBuffer PCM16LE 16k mono
          const txt = await self.whisperTranscribePCM(pcmBuffer);
          return txt;
        };
        postLog('whisper wrapper connected.');
      }
    } else {
      postLog('No whisperInit found. Worker will run in placeholder mode until you provide a wrapper.');
    }
  } catch (err) {
    postLog('WASM init error: ' + err);
  }
}
