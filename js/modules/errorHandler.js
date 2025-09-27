// Error handling functionality
export class ErrorHandler {
  constructor(statusElement, transcriptElement) {
    this.statusElement = statusElement;
    this.transcriptElement = transcriptElement;
    this.errors = [];
  }

  showError(message, type = 'error', details = null) {
    const error = {
      message,
      type,
      timestamp: new Date(),
      details
    };
    
    this.errors.push(error);

    // Update UI
    this.statusElement.classList.remove('success', 'warning', 'error');
    this.statusElement.classList.add(type);
    this.statusElement.textContent = message;

    if (type === 'error') {
      console.error(message, details);
      this.transcriptElement.textContent = "Error occurred. Please try again.";
    }

    // If it's a critical error, show alert
    if (type === 'error') {
      this.showErrorModal(message);
    }
  }

  showErrorModal(message) {
    const modal = document.createElement('div');
    modal.className = 'error-modal';
    modal.innerHTML = `
      <div class="error-modal-content">
        <div class="error-modal-header">
          <h3>⚠️ Error</h3>
          <button class="close-button">&times;</button>
        </div>
        <div class="error-modal-body">
          <p>${message}</p>
        </div>
        <div class="error-modal-footer">
          <button class="error-modal-close">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    const closeModal = () => {
      modal.classList.add('fade-out');
      setTimeout(() => modal.remove(), 300);
    };

    modal.querySelector('.close-button').onclick = closeModal;
    modal.querySelector('.error-modal-close').onclick = closeModal;
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    // Animate in
    requestAnimationFrame(() => modal.classList.add('show'));
  }

  clearErrors() {
    this.errors = [];
    this.statusElement.classList.remove('success', 'warning', 'error');
  }

  hasErrors() {
    return this.errors.length > 0;
  }

  getLastError() {
    return this.errors[this.errors.length - 1];
  }
}