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
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 opacity-0 transition-opacity duration-300';
    modal.innerHTML = `
      <div class="bg-white rounded-lg max-w-md w-11/12 transform transition-transform duration-300 scale-95">
        <div class="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 class="text-lg font-semibold text-red-600 flex items-center">
            <span class="mr-2">⚠️</span> Error
          </h3>
          <button class="text-gray-400 hover:text-gray-600 transition-colors text-2xl leading-none">&times;</button>
        </div>
        <div class="p-4">
          <p class="text-gray-700">${message}</p>
        </div>
        <div class="flex justify-end p-4 border-t border-gray-200">
          <button class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg transition-colors">
            Close
          </button>
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