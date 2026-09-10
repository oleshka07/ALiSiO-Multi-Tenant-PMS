/*
 * Повернення на кіоск — і забуття чужого сайту.
 *
 * Тільки тут є право чистити cookies і сховище: content-скрипт його не має,
 * і це правильно — така робота мусить бути в одному місці, а не в кожній
 * вкладці.
 *
 * Чиститься ЛИШЕ той origin, з якого прийшли: `browsingData.remove` без
 * `origins` знесла б і сесію самого кіоска, тобто токен пристрою, і термінал
 * попросив би код парування посеред робочого дня.
 */

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'kiosk-home') return;

  chrome.storage.local.get(['kioskUrl'], ({ kioskUrl }) => {
    if (!kioskUrl) return;
    const done = () => {
      if (sender.tab?.id !== undefined) chrome.tabs.update(sender.tab.id, { url: kioskUrl });
    };
    if (!message.origin) { done(); return; }
    chrome.browsingData.remove(
      { origins: [message.origin] },
      { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true },
      done,
    );
  });
});
