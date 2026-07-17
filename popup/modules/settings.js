// Settings UI — extension toggle, theme, view stats

export function initSettings() {
  const extensionToggle = document.getElementById('extensionToggle');
  const toggleLabel = document.getElementById('toggleLabel');
  const themeToggle = document.getElementById('themeToggle');
  const moonIcon = document.getElementById('moonIcon');
  const sunIcon = document.getElementById('sunIcon');
  const viewStatsBtn = document.getElementById('viewStatsBtn');

  loadSettings();

  viewStatsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('analysis/analysis.html') });
  });

  extensionToggle.addEventListener('change', () => {
    const isEnabled = extensionToggle.checked;
    chrome.storage.local.set({ extensionEnabled: isEnabled }, () => {
      updateToggleUI(isEnabled);
    });
  });

  themeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark');
    chrome.storage.local.set({ theme: isDark ? 'dark' : 'light' });
    updateThemeUI(isDark);
  });

  function loadSettings() {
    chrome.storage.local.get({ extensionEnabled: true, theme: 'light' }, (data) => {
      extensionToggle.checked = data.extensionEnabled;
      updateToggleUI(data.extensionEnabled);

      const isDark = data.theme === 'dark';
      document.body.classList.toggle('dark', isDark);
      updateThemeUI(isDark);
    });
  }

  function updateThemeUI(isDark) {
    moonIcon.style.display = isDark ? 'none' : 'block';
    sunIcon.style.display = isDark ? 'block' : 'none';
  }

  function updateToggleUI(isEnabled) {
    toggleLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';
    toggleLabel.style.color = isEnabled ? 'var(--primary-strong)' : 'var(--muted)';
  }
}
