/*
 * Смуга «Zurueck zum Start» і той самий таймер — на КОЖНІЙ сторінці, крім
 * самого кіоска.
 *
 * Навіщо розширення, а не наша сторінка. Walk-in (КІ8) веде гостя на власний
 * онлайн-модуль готелю, і та сторінка віддає `X-Frame-Options: DENY` — у
 * рамку її не вбудувати. Тобто гість опиняється на ЧУЖОМУ сайті у
 * повноекранному браузері без адресного рядка: назад немає чим, а через
 * хвилину бездіяльності на екрані лишається його напівзаповнена форма
 * бронювання з прізвищем і датами.
 *
 * Розширення додає рівно дві речі, яких там бракує, і не додає нічого більше:
 * кнопку повернення і забуття. Воно НЕ читає полів, не слухає ввід і нічого
 * нікуди не шле — у нього немає жодного мережевого виклику. Єдина причина
 * широких дозволів (`<all_urls>`) у тому, що заздалегідь невідомо, який саме
 * сайт бронювання в цього готелю: адресу вписує оператор на сторінці
 * налаштувань, і в коді її немає (інваріант 20).
 */

const IDLE_WARN_MS = 45_000;
const IDLE_RESET_MS = 60_000;

chrome.storage.local.get(['kioskUrl'], ({ kioskUrl }) => {
  // Адреси кіоска не задано — розширення не робить НІЧОГО. Вгадувати, який
  // сайт «наш», означало б показати смугу повернення на випадковій сторінці.
  if (!kioskUrl) return;

  let kioskOrigin;
  try {
    kioskOrigin = new URL(kioskUrl).origin;
  } catch {
    return;
  }
  // На самому кіоску смуга зайва: там свій таймер і свої кнопки.
  if (window.location.origin === kioskOrigin) return;

  const bar = document.createElement('div');
  bar.id = 'alisio-kiosk-bar';
  bar.textContent = '← Zurück zum Start';
  bar.addEventListener('click', goHome);
  document.documentElement.appendChild(bar);

  let warned = null;
  let reset = null;

  function goHome() {
    // Стан ЧУЖОГО сайту чиститься службою: content-скрипт не має на це
    // права, а лишити його означало б, що наступний гість відкриє форму
    // бронювання, наполовину заповнену попереднім.
    chrome.runtime.sendMessage({ type: 'kiosk-home', origin: window.location.origin });
  }

  function arm() {
    window.clearTimeout(warned);
    window.clearTimeout(reset);
    bar.dataset.warn = 'false';
    warned = window.setTimeout(() => { bar.dataset.warn = 'true'; }, IDLE_WARN_MS);
    reset = window.setTimeout(goHome, IDLE_RESET_MS);
  }

  for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(event, arm, { passive: true });
  }
  arm();
});
