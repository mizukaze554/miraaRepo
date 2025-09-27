// UI Elements and controls
import { ErrorHandler } from './errorHandler.js';

export const elements = {
  fileEl: document.getElementById("videoFile"),
  preview: document.getElementById("preview"),
  startBtn: document.getElementById("startBtn"),
  statusEl: document.getElementById("status"),
  progBar: document.getElementById("prog"),
  transcriptEl: document.getElementById("transcript"),
  isolateEl: document.getElementById("isolate"),
  langEl: document.getElementById("lang"),
  modelEl: document.getElementById("model"),
  downloadAudioBtn: document.getElementById("downloadAudio"),
  downloadTranscriptBtn: document.getElementById("downloadTranscript"),
  progressContainer: document.querySelector(".progress-container")
};

// Initialize error handler
const errorHandler = new ErrorHandler(elements.statusEl, elements.transcriptEl);

export function setStatus(msg, pct = null, type = 'normal') {
  elements.statusEl.textContent = msg;
  
  // Reset classes
  elements.statusEl.className = 'text-sm transition-all duration-300';
  
  // Add type-specific classes
  switch (type) {
    case 'error':
      elements.statusEl.classList.add('text-red-600');
      break;
    case 'warning':
      elements.statusEl.classList.add('text-amber-600');
      break;
    case 'success':
      elements.statusEl.classList.add('text-emerald-600');
      break;
    default:
      elements.statusEl.classList.add('text-gray-600');
  }
  
  if (pct !== null) {
    const width = Math.min(100, Math.max(0, pct));
    elements.progBar.style.width = width + "%";
    
    // Add loading state
    if (width > 0 && width < 100) {
      elements.statusEl.classList.add('animate-pulse');
    } else {
      elements.statusEl.classList.remove('animate-pulse');
    }
  }

  // Show success state when complete
  if (pct === 100) {
    elements.statusEl.className = 'text-sm text-emerald-600 font-medium';
  }
}

export function showError(message, details = null) {
  errorHandler.showError(message, 'error', details);
}

export function showWarning(message) {
  errorHandler.showError(message, 'warning');
}

export function showSuccess(message) {
  errorHandler.showError(message, 'success');
}

export function setupFileInput(onFileSelect) {
  elements.fileEl.addEventListener("change", onFileSelect);

  // Add drag and drop support
  const dropZone = document.createElement('div');
  dropZone.className = 'drop-zone';
  dropZone.innerHTML = `
    <div class="drop-zone-content">
      <span>Drop your video file here</span>
      <span class="small">or click to browse</span>
    </div>
  `;
  
  elements.fileEl.parentElement.appendChild(dropZone);

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    
    if (e.dataTransfer.files.length) {
      elements.fileEl.files = e.dataTransfer.files;
      onFileSelect({ target: elements.fileEl });
    }
  });

  dropZone.addEventListener('click', () => {
    elements.fileEl.click();
  });
}

export function createDownloadLink(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    showError('Failed to create download link', error);
  }
}

export function disableButton(button, disabled = true) {
  button.disabled = disabled;
  if (disabled) {
    button.classList.add('disabled');
  } else {
    button.classList.remove('disabled');
  }
}

// Add loading indicator to buttons
export function setButtonLoading(button, isLoading) {
  if (isLoading) {
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = `<span class="loading-spinner"></span>${button.innerHTML}`;
    button.classList.add('loading');
    button.disabled = true;
  } else {
    if (button.dataset.originalText) {
      button.innerHTML = button.dataset.originalText;
      delete button.dataset.originalText;
    }
    button.classList.remove('loading');
    button.disabled = false;
  }
}

// Initialize UI enhancements
export function initializeUI() {
  // Add icons to buttons
  elements.startBtn.innerHTML = '▶️ ' + elements.startBtn.innerHTML;
  elements.downloadAudioBtn.innerHTML = '🔊 ' + elements.downloadAudioBtn.innerHTML;
  elements.downloadTranscriptBtn.innerHTML = '📝 ' + elements.downloadTranscriptBtn.innerHTML;

  // Add tooltips
  elements.startBtn.title = 'Process video and generate transcript';
  elements.downloadAudioBtn.title = 'Download processed audio file';
  elements.downloadTranscriptBtn.title = 'Download generated transcript';

  // Enhance select elements with custom styling
  document.querySelectorAll('select').forEach(select => {
    select.classList.add('enhanced-select');
  });
}