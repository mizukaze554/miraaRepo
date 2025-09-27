export function getEls() {
  return {
    videoInput: document.getElementById('videoFile'),
    preview: document.getElementById('preview'),
    dropZone: document.querySelector('.drop-zone'),
    startBtn: document.getElementById('startBtn'),
    downloadAudioBtn: document.getElementById('downloadAudio'),
    downloadTranscriptBtn: document.getElementById('downloadTranscript'),
    statusEl: document.getElementById('status'),
    progEl: document.getElementById('prog'),
    transcriptEl: document.getElementById('transcript'),
    segmentsContainer: document.getElementById('segments'),
    subtitleEl: document.getElementById('subtitle'),
  };
}

export function setStatus(text, extraClass = '') {
  const statusEl = document.getElementById('status');
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = 'text-sm font-medium px-3 py-1 rounded-full bg-gray-100 text-gray-600';
  if (extraClass) statusEl.classList.add(extraClass);
}

export function setProgress(p) {
  const progEl = document.getElementById('prog');
  if (!progEl) return;
  progEl.style.width = `${p}%`;
}
