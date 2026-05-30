console.log('Focus Flow Analyzer: Content script loaded');

function createNudgeModal(domain) {
    const existingModal = document.getElementById('focus-flow-nudge-container');
    if (existingModal) existingModal.remove();

    const container = document.createElement('div');
    container.id = 'focus-flow-nudge-container';

    // Inject CSS
    const style = document.createElement('style');
    style.textContent = `
    #focus-flow-nudge-container {
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      pointer-events: none;
    }

    #focus-flow-nudge-modal {
      width: 340px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      alignItems: center;
      text-align: center;
      gap: 16px;
      pointer-events: auto;
      transform: translateY(-20px);
      opacity: 0;
      animation: focusFlowSlideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    @keyframes focusFlowSlideIn {
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .focus-flow-logo-container {
      width: 80px;
      height: 80px;
      margin: 0 auto;
      position: relative;
      background: linear-gradient(135deg, #6e8efb 0%, #a777e3 100%);
      padding: 4px;
      border-radius: 22px;
      box-shadow: 0 8px 16px rgba(110, 142, 251, 0.3);
    }

    .focus-flow-logo {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 18px;
      background: white;
    }

    .focus-flow-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .focus-flow-title {
      font-size: 20px;
      font-weight: 700;
      margin: 0;
      background: linear-gradient(135deg, #1a73e8 0%, #a777e3 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.5px;
    }

    .focus-flow-message {
      font-size: 15px;
      color: #5f6368;
      line-height: 1.5;
      margin: 0;
    }

    .focus-flow-domain {
      font-weight: 600;
      color: #202124;
      display: block;
      margin-top: 4px;
    }

    .focus-flow-button {
      margin-top: 8px;
      padding: 12px 24px;
      background: #1a73e8;
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(26, 115, 232, 0.2);
    }

    .focus-flow-button:hover {
      background: #1557b0;
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(26, 115, 232, 0.3);
    }

    .focus-flow-button:active {
      transform: translateY(0);
    }
  `;

    const modal = document.createElement('div');
    modal.id = 'focus-flow-nudge-modal';

    const logoContainer = document.createElement('div');
    logoContainer.className = 'focus-flow-logo-container';

    const logo = document.createElement('img');
    logo.className = 'focus-flow-logo';
    // Use icon.png from root as it's the high-res one
    logo.src = chrome.runtime.getURL('icon.png');
    logo.onerror = () => {
        // Fallback to icons/icon128.png if root icon.png fails
        logo.src = chrome.runtime.getURL('icons/icon128.png');
    };

    logoContainer.appendChild(logo);

    const content = document.createElement('div');
    content.className = 'focus-flow-content';

    const title = document.createElement('h3');
    title.className = 'focus-flow-title';
    title.textContent = 'Stay Focused';

    const message = document.createElement('p');
    message.className = 'focus-flow-message';
    message.innerHTML = `You are exploring <span class="focus-flow-domain">${domain}</span>.<br>Time to get back to work!`;

    const button = document.createElement('button');
    button.className = 'focus-flow-button';
    button.textContent = 'Return to Studies';
    button.onclick = () => {
        modal.style.transform = 'translateY(-20px)';
        modal.style.opacity = '0';
        modal.style.transition = 'all 0.3s ease-in';
        setTimeout(() => container.remove(), 300);
    };

    // Assemble
    content.appendChild(title);
    content.appendChild(message);

    modal.appendChild(logoContainer);
    modal.appendChild(content);
    modal.appendChild(button);

    container.appendChild(style);
    container.appendChild(modal);

    document.body.appendChild(container);

    // Auto-remove after 15 seconds
    setTimeout(() => {
        if (container.parentNode) {
            modal.style.transform = 'translateY(-20px)';
            modal.style.opacity = '0';
            modal.style.transition = 'all 0.3s ease-in';
            setTimeout(() => container.remove(), 300);
        }
    }, 15000);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'showFocusNudge') {
        createNudgeModal(request.domain);
    }
});
