const field = document.getElementById('url');
const ok = document.getElementById('ok');

chrome.storage.local.get(['kioskUrl'], ({ kioskUrl }) => {
  if (kioskUrl) field.value = kioskUrl;
});

document.getElementById('save').addEventListener('click', () => {
  const value = field.value.trim();
  // Порожнє поле — це «вимкнути», а не «лишити як було»: оператор мусить мати
  // спосіб зупинити розширення, не видаляючи його.
  chrome.storage.local.set({ kioskUrl: value }, () => {
    ok.textContent = value ? ' ✓' : ' —';
  });
});
