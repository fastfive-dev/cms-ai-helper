// popup.js — Server URL setting only.

const serverUrlInput = document.getElementById('serverUrlInput');
const saveServerBtn = document.getElementById('saveServerBtn');
const serverSaveMsg = document.getElementById('serverSaveMsg');

chrome.storage.sync.get('serverUrl', (data) => {
  if (data.serverUrl) {
    serverUrlInput.value = data.serverUrl;
  }
});

saveServerBtn.addEventListener('click', () => {
  const url = serverUrlInput.value.trim().replace(/\/+$/, '');
  if (!url) return;
  chrome.storage.sync.set({ serverUrl: url }, () => {
    serverSaveMsg.textContent = '저장됨!';
    serverSaveMsg.style.display = 'block';
    setTimeout(() => { serverSaveMsg.style.display = 'none'; }, 3000);
  });
});
