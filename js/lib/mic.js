export async function tryLiveMicTranscribe(wavBlob, seg) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert('SpeechRecognition not available'); return; }
  const url = URL.createObjectURL(wavBlob);
  const audio = new Audio(url); audio.crossOrigin='anonymous'; audio.volume=1;
  const recognition = new SpeechRecognition();
  try { recognition.lang = (document.getElementById('lang') && document.getElementById('lang').value) || 'en-US'; } catch(_) {}
  recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
  let finalText = '', interimText = '';
  recognition.onresult = (event) => {
    interimText = '';
    for (let i=event.resultIndex;i<event.results.length;i++){
      const r = event.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' ';
      else interimText += r[0].transcript + ' ';
    }
    document.getElementById('transcript').textContent = (finalText + interimText).trim();
  };
  recognition.onstart = ()=>{}; recognition.onerror = (e)=>console.warn(e);
  try { recognition.start(); } catch(err) { console.warn(err); }
  try { await audio.play(); } catch(_) {}
  await new Promise((res)=> {
    let ended=false;
    const onAudioEnd = ()=>{ ended=true; res(); };
    audio.addEventListener('ended', onAudioEnd, {once:true});
    recognition.onend = ()=>{ if (!ended) { try{audio.pause(); }catch(_){}; res(); } else res(); };
    setTimeout(()=>res(), (seg && seg.duration ? Math.ceil(seg.duration) : 10)*1000 + 5000);
  });
  try{ recognition.stop(); }catch(_){}
  URL.revokeObjectURL(url);
  const t = finalText.trim();
  if (t) document.getElementById('transcript').textContent = t;
  return t;
}

export function injectLiveControl() {
  // attempt to place a Start Live Mic button next to downloadTranscript
  try {
    const dl = document.getElementById('downloadTranscript');
    if (!dl || !dl.parentNode) return;
    const btn = document.createElement('button');
    btn.textContent = 'Start Live Mic';
    btn.className = 'ml-2 px-3 py-1 bg-indigo-600 text-white rounded text-sm';
    let recog = null;
    btn.onclick = () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { alert('SpeechRecognition not supported'); return; }
      if (!recog) {
        recog = new SpeechRecognition();
        try { recog.lang = (document.getElementById('lang') && document.getElementById('lang').value) || 'en-US'; } catch(_) {}
        recog.continuous = true; recog.interimResults = true;
        recog.onresult = (event)=>{ let text=''; for (let i=event.resultIndex;i<event.results.length;i++){ const r=event.results[i]; text += (r.isFinal? r[0].transcript+' ' : r[0].transcript+' '); } document.getElementById('transcript').textContent = text; };
        recog.onend = ()=>{ recog = null; btn.textContent = 'Start Live Mic'; };
        recog.onerror = (e)=>{ console.warn(e); };
        try { recog.start(); btn.textContent = 'Stop Live Mic'; } catch (err) { console.warn(err); }
      } else {
        try { recog.stop(); } catch(_) { }
        recog = null;
        btn.textContent = 'Start Live Mic';
      }
    };
    dl.parentNode.appendChild(btn);
  } catch (_) {}
}
