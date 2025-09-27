export async function loadTransformersModule() {
  const esmCandidates = [
    'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm',
    'https://esm.sh/@xenova/transformers@2.17.2',
    'https://unpkg.com/@xenova/transformers@2.17.2/+esm'
  ];
  let lastErr = null;
  for (const url of esmCandidates) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      if (mod && (mod.pipeline || (mod.default && mod.default.pipeline))) return mod;
      if (mod && mod.default && typeof mod.default === 'object' && mod.default.pipeline) return mod.default;
      lastErr = new Error('ESM module loaded but pipeline missing: ' + url + ' exports: ' + Object.keys(mod || {}).join(','));
    } catch (err) {
      lastErr = err;
      console.warn('ESM import failed', url, err && err.message);
    }
  }

  // UMD fallback
  const umdCandidates = [
    'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js',
    'https://unpkg.com/@xenova/transformers@2.17.2/dist/transformers.min.js'
  ];
  for (const url of umdCandidates) {
    try {
      await new Promise((res, rej) => {
        if (window.transformers || window.Transformers || window.xenovaTransformers) return res();
        const s = document.createElement('script');
        s.src = url; s.async = true;
        s.onload = () => setTimeout(res, 50);
        s.onerror = () => rej(new Error('Script load error: ' + url));
        document.head.appendChild(s);
        setTimeout(()=>rej(new Error('Script load timeout: ' + url)), 20000);
      });
      const globalMod = window.transformers || window.Transformers || window.xenovaTransformers || null;
      if (globalMod) {
        if (typeof globalMod.pipeline === 'function') return globalMod;
        if (globalMod.default && typeof globalMod.default.pipeline === 'function') return globalMod.default;
        lastErr = new Error('UMD loaded but pipeline missing: ' + url + ' keys: ' + Object.keys(globalMod || {}).join(','));
      } else {
        lastErr = new Error('UMD loaded but global not found: ' + url);
      }
    } catch (err) {
      lastErr = err;
      console.warn('UMD injection failed', url, err && err.message);
    }
  }
  throw lastErr || new Error('No transformers module available');
}

export async function transcribeWithTransformers(wavBlob, modelId='Xenova/whisper-tiny') {
  const mod = await loadTransformersModule();
  const pipelineFunc = mod.pipeline || (mod.default && mod.default.pipeline);
  if (!pipelineFunc) throw new Error('pipeline export not found on loaded module');
  const asr = await pipelineFunc('automatic-speech-recognition', modelId);
  const res = await asr(wavBlob);
  if (!res) return '';
  if (typeof res === 'string') return res;
  if (res.text) return res.text;
  if (res.generated_text) return res.generated_text;
  if (Array.isArray(res) && res.length) return res.map(r => r && (r.text || r.generated_text || '')).join(' ').trim();
  return JSON.stringify(res);
}
