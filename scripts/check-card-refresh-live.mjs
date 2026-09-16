/**
 * ПРАВКА НА КАРТЦІ БРОНІ НЕ ПРИБИРАЄ КАРТКУ З ЕКРАНА.
 *
 *   npm run build && npm run start            # прод-збірка, стенд §7
 *   BASE_URL=http://localhost:3000 CHROMIUM_PATH=… \
 *   PROBE_EMAIL=… PROBE_PASSWORD=… \
 *     node scripts/check-card-refresh-live.mjs
 *
 * ── Дефект, проти якого це написано ─────────────────────────────────────
 *
 * Власник: «змінюю платника — воно завісає секунд на 15». Перше припущення
 * (список броней важкий) було ВИМІРЯНЕ і виявилось хибним: 2000 броней —
 * 45 мс. Причина знайшлась лише в браузері й виявилась не про запити:
 *
 *   `fetchData()` шахматки ставив `loading = true`, а сторінка має РАННІЙ
 *   ВИХІД «Завантаження…» на весь екран. Тобто кожне оновлення підміняло
 *   сторінку спіннером РАЗОМ ІЗ ВІДКРИТОЮ КАРТКОЮ. Картка не ховалась —
 *   вона розмонтовувалась, і, повернувшись, кожна панель перепитувала своє
 *   наново.
 *
 * Виміряно до правки (45 номерів, 400 броней, затримка 120 мс): 1.9 с на
 * зміну платника, з них 82 % кадрів картки НЕМАЄ на екрані; сама зміна —
 * 137 мс, решта — перезавантаження всієї шахматки і повернення картки з
 * сімома зайвими запитами. На живому готелі кожна ланка довша, і ланцюжок
 * читається як «завісло».
 *
 * ── Що тут стверджується ────────────────────────────────────────────────
 *
 * ВЛАСТИВІСТЬ, а не число: під час правки на картці картка ЛИШАЄТЬСЯ на
 * екрані. Час друкується поруч, але червоним його не роблять — секунди
 * залежать від машини, а зникла картка не залежить ні від чого.
 *
 * Числа поруч (запити з часом старту, кадри, головний потік) — щоб наступний
 * читач не вгадував, а бачив, з чого складається затримка.
 *
 * ── Куди цим НЕ можна цілитись ──────────────────────────────────────────
 *
 * Прохід ПИШЕ: він міняє платника броні, яку знайде першою, і повертає його
 * назад. Тому BASE_URL — лише СВІЙ стенд над СВОЄЮ базою. Ні бета, ні прод.
 *
 * Пароль — лише з оточення. Літерала тут немає навмисно (інваріант 7).
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL;
const PASSWORD = process.env.PROBE_PASSWORD;
const LATENCY = Number(process.env.LATENCY_MS || 0);

if (!EMAIL || !PASSWORD) {
  console.error('потрібні PROBE_EMAIL і PROBE_PASSWORD — це прохід під живою сесією');
  process.exit(2);
}

const ms = (n) => `${Math.round(n)} мс`;
const problems = [];
const claim = (cond, what) => {
  if (cond) console.log(`  ok  ${what}`);
  else { problems.push(what); console.log(`  ✗   ${what}`); }
};

// `CHROMIUM_PATH` — для середовищ, де браузер уже лежить поруч і його не
// качають (наприклад, PLAYWRIGHT_BROWSERS_PATH контейнера). Без нього
// береться той, який поставив `npx playwright install chromium`.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

if (LATENCY > 0) {
  // Власник сидить не на localhost. Один екран, поділений на N запитів,
  // коштує N затримок — саме тому число запитів тут і рахується.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: LATENCY,
    downloadThroughput: (5 * 1024 * 1024) / 8, uploadThroughput: (1024 * 1024) / 8,
  });
  console.log(`затримка мережі: ${LATENCY} мс на запит`);
}

const net = [];
const startedAt = new Map();
// Час беремо СВОЇМ годинником, синхронно. `req.timing()` повертає проміс, і
// запис у `net` встигав лягти вже ПІСЛЯ того, як блок зняв свій знімок: гейт
// доповідав «0 PATCH» на прогоні, де PATCH був. Виміряно точно, але не те —
// тільки цього разу в самому вимірювачі.
page.on('request', (req) => startedAt.set(req, Date.now()));
page.on('requestfinished', (req) => {
  const t0 = startedAt.get(req);
  if (t0 === undefined) return;
  startedAt.delete(req);
  net.push({ url: req.url().replace(BASE, ''), method: req.method(), start: t0, dur: Date.now() - t0 });
});

const measured = async (label, fn) => {
  net.length = 0;
  const t0 = Date.now();
  await fn();
  const wall = Date.now() - t0;
  const api = net.filter((r) => r.url.includes('/api/')).sort((a, b) => a.start - b.start);
  const first = api.length ? api[0].start : 0;
  console.log(`\n── ${label}: ${ms(wall)}, ${api.length} запитів до API`);
  for (const r of api) {
    console.log(`     +${String(Math.round(r.start - first)).padStart(5)} мс  ${r.method.padEnd(6)} ${r.url.slice(0, 60).padEnd(60)} ${ms(r.dur)}`);
  }
  return { wall, api };
};

try {
  // ── Вхід ───────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 60000 }),
    page.click('button[type="submit"]'),
  ]);

  await measured('відкриття шахматки', async () => {
    await page.goto(`${BASE}/app/calendar`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 120000 });
  });

  const bars = await page.locator('div[draggable="true"]').count();
  claim(bars > 0, `на шахматці є смужки броні (${bars})`);
  if (!bars) throw new Error('немає жодної броні — засійте стенд');

  await measured('відкриття картки броні', async () => {
    await page.locator('div[draggable="true"]').first().click({ timeout: 15000 });
    await page.locator('text=Платник').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  });

  const payer = () => page.locator('select').filter({ hasText: 'Гість (фізособа)' }).first();

  // Значення, ВІДМІННЕ від нинішнього — інакше `selectOption` не дає події
  // `change`, PATCH не летить, і гейт зелений на тому, що нічого не сталось.
  // Саме так він і був зелений з першого разу (AGENTS §3.2), доки не почав
  // стверджувати, що зміна справді поїхала на сервер.
  // Довідник фірм приїжджає своїм запитом уже після того, як картка є на
  // екрані: читати варіанти раніше — це читати порожню випадайку і робити з
  // цього висновок.
  await page.waitForFunction(() => {
    const s = [...document.querySelectorAll('select')].find((x) => x.innerHTML.includes('фізособа'));
    return !!s && !s.disabled && s.options.length > 1;
  }, null, { timeout: 30000 });

  const now = await payer().inputValue();
  const option = await page.evaluate((current) => {
    const s = [...document.querySelectorAll('select')].find((x) => x.innerHTML.includes('фізособа'));
    const other = [...(s?.options ?? [])].find((o) => o.value && o.value !== current);
    return other?.value ?? '';
  }, now);
  claim(!!option, `у довіднику є фірма, на яку платника ще НЕ переведено (нинішній: ${now || 'гість'})`);
  if (!option) throw new Error('немає іншої фірми в довіднику');

  // ── Спостерігач: чи є картка на екрані КОЖЕН кадр ──────────────────────
  await page.evaluate(() => {
    window.__watch = { frames: 0, cardGone: 0, spinner: 0, stop: false };
    const tick = () => {
      if (window.__watch.stop) return;
      window.__watch.frames++;
      const card = [...document.querySelectorAll('select')].some((s) => s.innerHTML.includes('фізособа'));
      if (!card) window.__watch.cardGone++;
      if ((document.body.textContent || '').includes('Завантаження...')) window.__watch.spinner++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Небезпечне вікно ширше за сам PATCH: оновлення списку, яке картка
  // замовляє після зміни, приїжджає ПІЗНІШЕ — і колись саме воно й підміняло
  // екран спіннером. Тому запис триває ще три секунди після того, як
  // випадайка відпустилась, а стінний час рахується до неї: людина чекає
  // саме на неї.
  net.length = 0;
  const tChange = Date.now();
  await payer().selectOption(option);
  await page.waitForFunction(() => {
    const s = [...document.querySelectorAll('select')].find((x) => x.innerHTML.includes('фізособа'));
    return s && !s.disabled;
  }, null, { timeout: 120000 });
  const wallToReady = Date.now() - tChange;
  await page.waitForTimeout(3000);

  const change = { wall: wallToReady, api: net.filter((r) => r.url.includes('/api/')).sort((a, b) => a.start - b.start) };
  console.log(`\n── ЗМІНА ПЛАТНИКА: ${ms(change.wall)} до відпущеної випадайки, ${change.api.length} запитів за наступні 3 с`);
  for (const r of change.api) {
    console.log(`     +${String(r.start - tChange).padStart(5)} мс  ${r.method.padEnd(6)} ${r.url.slice(0, 60).padEnd(60)} ${ms(r.dur)}`);
  }

  const watch = await page.evaluate(() => { window.__watch.stop = true; return window.__watch; });
  console.log(`\n   кадрів: ${watch.frames}; картки не було: ${watch.cardGone}; спіннер на весь екран: ${watch.spinner}`);
  console.log(`   стінний час до відпущеної випадайки: ${ms(change.wall)}`);

  // Спершу — що зміна ВЗАГАЛІ сталась. Без цього обидва твердження нижче
  // істинні на бездіяльності: нічого не робили — нічого й не зникло.
  claim(change.api.some((r) => r.method === 'PATCH'),
    `зміна поїхала на сервер (${change.api.filter((r) => r.method === 'PATCH').length} PATCH)`);
  claim(watch.frames >= 20,
    `екран роздивлялись достатньо довго (${watch.frames} кадрів)`);

  claim(watch.cardGone === 0,
    `картка лишалась на екрані всю зміну (не було на ${watch.cardGone} кадрах із ${watch.frames})`);
  claim(watch.spinner === 0,
    `екран не підмінявся спіннером «Завантаження...» (підмінявся на ${watch.spinner} кадрах)`);

  // ── Прибрати за собою: платник назад у «гість» ─────────────────────────
  await payer().selectOption('');
  await page.waitForTimeout(1500);
} catch (e) {
  problems.push(`прохід обірвався: ${e?.message || e}`);
  console.log(`  ✗   прохід обірвався: ${e?.message || e}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.error(`\ncard-refresh-live: ${problems.length} червоних`);
  process.exit(1);
}
console.log('\ncard-refresh-live: правка на картці не прибирає картку з екрана');
