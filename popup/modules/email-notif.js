// Email Notifications UI
// Stores the user's email locally. The background worker uses it to send
// weekly summaries via a lightweight email service (EmailJS / serverless function).

export function initEmailNotif() {
  const emailInput = document.getElementById('emailNotifInput');
  const saveBtn = document.getElementById('saveEmailBtn');
  const removeBtn = document.getElementById('removeEmailBtn');
  const setupSection = document.getElementById('emailNotifSetup');
  const activeSection = document.getElementById('emailNotifActive');
  const addressEl = document.getElementById('emailNotifAddress');
  const statusEl = document.getElementById('emailNotifStatus');

  // Load saved state
  chrome.storage.local.get({ emailNotifAddress: '' }, (data) => {
    if (data.emailNotifAddress) {
      showActive(data.emailNotifAddress);
    }
  });

  saveBtn.addEventListener('click', saveEmail);
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEmail();
  });

  removeBtn.addEventListener('click', () => {
    chrome.storage.local.remove('emailNotifAddress', () => {
      showSetup();
      showStatus('Email removed. You won\'t receive weekly summaries.', false);
    });
  });

  function saveEmail() {
    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
      showStatus('Enter an email address.', true);
      return;
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showStatus('Invalid email address.', true);
      return;
    }

    chrome.storage.local.set({ emailNotifAddress: email }, () => {
      showActive(email);
      showStatus('Saved! You\'ll get weekly summaries.', false);
      emailInput.value = '';
    });
  }

  function showActive(email) {
    setupSection.style.display = 'none';
    activeSection.style.display = 'block';
    addressEl.textContent = email;
  }

  function showSetup() {
    setupSection.style.display = 'block';
    activeSection.style.display = 'none';
  }

  function showStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? 'var(--danger)' : 'var(--primary-strong)';
    setTimeout(() => { statusEl.textContent = ''; }, 3500);
  }
}
