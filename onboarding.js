let selectedDomains = new Set();

// Navigation
document.getElementById('btnGoStep2').addEventListener('click', () => goToStep(2));
document.getElementById('btnBackStep1').addEventListener('click', () => goToStep(1));
document.getElementById('btnGoStep3').addEventListener('click', () => goToStep(3));
document.getElementById('btnBackStep2').addEventListener('click', () => goToStep(2));
document.getElementById('btnGoStep4').addEventListener('click', () => goToStep(4));
document.getElementById('btnBackStep3').addEventListener('click', () => goToStep(3));
document.getElementById('btnFinish').addEventListener('click', finishSetup);
document.getElementById('btnSkip3').addEventListener('click', () => goToStep(4));
document.getElementById('btnAddCustom').addEventListener('click', addCustomDomain);

// Chip selection
document.querySelectorAll('.domain-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const domain = chip.dataset.domain;
    if (selectedDomains.has(domain)) {
      selectedDomains.delete(domain);
      chip.classList.remove('selected');
    } else {
      selectedDomains.add(domain);
      chip.classList.add('selected');
    }
    updateSelectedList();
  });
});

// Custom domain input
document.getElementById('customDomainInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addCustomDomain();
});

function addCustomDomain() {
  const input = document.getElementById('customDomainInput');
  let domain = input.value.trim().toLowerCase();
  if (!domain) return;
  domain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  if (domain && domain.includes('.')) {
    selectedDomains.add(domain);
    updateSelectedList();
    input.value = '';
    document.querySelectorAll('.domain-chip').forEach(chip => {
      if (chip.dataset.domain === domain) chip.classList.add('selected');
    });
  }
}

function removeDomain(domain) {
  selectedDomains.delete(domain);
  document.querySelectorAll('.domain-chip').forEach(chip => {
    if (chip.dataset.domain === domain) chip.classList.remove('selected');
  });
  updateSelectedList();
}

function updateSelectedList() {
  const list = document.getElementById('selectedDomainsList');
  const count = document.getElementById('domainCount');
  count.textContent = selectedDomains.size;

  list.innerHTML = '';
  if (selectedDomains.size === 0) {
    list.innerHTML = '<span style="color:#64748b; font-size:13px;">No domains selected yet</span>';
    return;
  }
  selectedDomains.forEach(domain => {
    const tag = document.createElement('span');
    tag.className = 'selected-tag';
    tag.textContent = domain + ' ';
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeDomain(domain));
    tag.appendChild(removeBtn);
    list.appendChild(tag);
  });
}

function goToStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step' + n).classList.add('active');
  if (n === 3) updateSelectedList();
}

function finishSetup() {
  const domains = Array.from(selectedDomains);
  chrome.storage.local.set({
    studyDomains: domains,
    onboardingComplete: true
  }, () => {
    try {
      window.close();
    } catch(e) {}
    setTimeout(() => {
      window.location.href = chrome.runtime.getURL('analysis/analysis.html');
    }, 200);
  });
}

// Initialize
updateSelectedList();
