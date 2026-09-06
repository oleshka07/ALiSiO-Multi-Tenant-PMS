#!/usr/bin/env node
/**
 * Живий прохід планера: перетягування смуги СПРАВДІ переносить бронь.
 *
 *   npm run build && npm run start &
 *   WALK_SESSION=<cookie session_id> node scripts/walk-planner-drag.mjs
 *
 * Навіщо окремий прохід, коли є `calendar/drag.check.ts`. Той гейт доводить
 * арифметику ходу — куди лягає смуга, що заважає, чи хід взагалі можливий.
 * Він нічого не знає про те, чи ці функції під'єднані до екрана: між ними
 * стоїть HTML5 drag-and-drop, а це не клік, і зламатись воно може мовчки —
 * смуга просто не поїде, і жоден гейт цього не побачить.
 *
 * І доводити це мишею НЕ МОЖНА. Перший прохід 06.09.2026 робив
 * `mouse.down` → `mouse.move` → `mouse.up` над смугою, знімав екран і
 * називав знімок доказом перетягування. Chromium під CDP на такі рухи
 * HTML5-drag не запускає взагалі: на знімку було ВИДІЛЕННЯ ТЕКСТУ, підсвічені
 * назви номерів, і жодного `dragstart`. Прохід був зелений, бо дивився не на
 * те (той самий клас, що інваріант 21). Тому тут подаються справжні події
 * `dragstart`/`dragover`/`drop`, і — головне — результат читається НАЗАД
 * окремим запитом до API, а не з екрана (інваріант 27).
 *
 * Три речі, які доводяться, і кожна окремо:
 *   1. кидок на ЗАЙНЯТЕ місце нічого не змінює і каже причину;
 *   2. кидок на вільне переносить рівно ОДНУ бронь;
 *   3. кількість ночей при цьому НЕ міняється (Д14: це перенесення, а не
 *      розтягування) — і саме тому цільовий відрізок шукається на стільки ж
 *      ночей, скільки має бронь, а не на «якісь вільні дні».
 *
 * Прохід ПИШЕ: він переносить справжню бронь і повертає її на місце в кінці.
 * Ганяти лише на тестовому середовищі. Пароля у файлі немає — куку сесії
 * передає той, хто запускає, як у `smoke-writes.mjs`.
 */
import { chromium } from 'playwright';

const BASE = process.env.APP_URL || 'http://127.0.0.1:3000';
const SESSION = process.env.WALK_SESSION;
const DAY_W = 44; // ширина дня в режимі «місяць», calendar/page.tsx

if (!SESSION) {
  console.error('WALK_SESSION не задано: потрібна кука session_id користувача з правом на броні.');
  console.error('  WALK_SESSION=<cookie> node scripts/walk-planner-drag.mjs');
  process.exit(2);
}

const api = (path, init = {}) => fetch(`${BASE}${path}`, {
  ...init,
  headers: { Cookie: `session_id=${SESSION}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});

/** Місце кожної броні одним рядком — щоб різницю було видно порівнянням. */
async function placements() {
  const res = await api('/api/bookings?property=all&limit=500');
  if (!res.ok) throw new Error(`GET /api/bookings → ${res.status}`);
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body.bookings || body.items || body.data || []);
  return new Map(rows.map((b) => [b.id, {
    unit_id: b.unit_id, check_in: b.check_in, check_out: b.check_out, nights: b.nights,
    at: `${b.unit_id}|${b.check_in}|${b.check_out}`,
  }]));
}

const fails = [];
const ok = (msg) => console.log(`  ok  ${msg}`);
const bad = (msg) => { console.log(`  ЧЕРВОНЕ  ${msg}`); fails.push(msg); };

const before = await placements();
console.log(`планер: ${before.size} броней у списку`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: 'session_id', value: SESSION, url: BASE }]);
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept()); // «Інший тип номера» — підтверджуємо
page.on('pageerror', (e) => console.log('  помилка сторінки:', e.message));

await page.goto(`${BASE}/app/calendar?property=all`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const bar = page.locator('div[draggable="true"]').first();
await bar.waitFor({ timeout: 20000 });
const barBox = await bar.boundingBox();
const barH = await bar.elementHandle();
const rows = page.locator(`div[style*="height: ${38}px"][style*="position: relative"]`);

// Рядок іншого номера — перший, чий верх нижчий за смугу.
let targetRow = null; let targetBox = null;
for (let i = 0; i < await rows.count(); i += 1) {
  const b = await rows.nth(i).boundingBox();
  if (b && b.y > barBox.y + barBox.height + 4) { targetRow = rows.nth(i); targetBox = b; break; }
}
if (!targetRow) { console.error('немає жодного рядка номера нижче за смугу — планер порожній?'); process.exit(2); }
const rowH = await targetRow.elementHandle();

// Події подаються ОКРЕМИМИ кроками з паузами: `startDrag` кладе взяту бронь
// у стан React, і `dropOnRow` читає саме його. Подані одним синхронним
// блоком, вони приходять раніше, ніж стан оновився, і drop мовчки виходить
// на `if (!current) return` — прохід був би зелений, не зробивши нічого.
await page.evaluate(() => { window.__walkDt = new DataTransfer(); });
const fire = (node, type, x, y) => page.evaluate(({ n, t, cx, cy }) => n.dispatchEvent(
  new DragEvent(t, { dataTransfer: window.__walkDt, bubbles: true, cancelable: true, clientX: cx, clientY: cy })),
{ n: node, t: type, cx: x, cy: y });

async function dragTo(x, y) {
  await fire(barH, 'dragstart', barBox.x + 8, barBox.y + barBox.height / 2);
  await page.waitForTimeout(400);
  await fire(rowH, 'dragover', x, y);
  await page.waitForTimeout(250);
  const outline = await targetRow.evaluate((el) => getComputedStyle(el).outlineStyle);
  await fire(rowH, 'drop', x, y);
  await fire(barH, 'dragend', x, y);
  await page.waitForTimeout(2200);
  return outline;
}

const dropY = targetBox.y + targetBox.height / 2;

/** Колонки рядка, над якими нічого не лежить: ані смуга броні, ані закриття. */
const freeRun = (need) => targetRow.evaluate((row, [needed, dayW]) => {
  const r = row.getBoundingClientRect();
  const y = r.top + r.height / 2;
  const free = (i) => {
    const x = r.left + i * dayW + dayW / 2;
    if (x < r.left || x > r.right) return false;
    const el = document.elementFromPoint(x, y);
    return !!el && !el.closest('[draggable="true"]') && !el.closest('[title^="🔒"]');
  };
  const cols = Math.floor(r.width / dayW);
  for (let i = 1; i + needed < cols; i += 1) {
    let good = true;
    for (let k = 0; k <= needed; k += 1) if (!free(i + k)) { good = false; break; }
    if (good) return i;
  }
  return -1;
}, [need, DAY_W]);

/** Перша колонка рядка, ЗАЙНЯТА чужою бронню. */
const occupiedCol = () => targetRow.evaluate((row, dayW) => {
  const r = row.getBoundingClientRect();
  const y = r.top + r.height / 2;
  const cols = Math.floor(r.width / dayW);
  for (let i = 0; i < cols; i += 1) {
    const el = document.elementFromPoint(r.left + i * dayW + dayW / 2, y);
    if (el && el.closest('[draggable="true"]')) return i;
  }
  return -1;
}, DAY_W);

// ── 1. Кидок на зайняте місце ─────────────────────────────────────────────
const busy = await occupiedCol();
if (busy < 0) {
  console.log('  (пропущено) у цільовому рядку немає чужої броні, немає об що відмовитись');
} else {
  const outline = await dragTo(targetBox.x + busy * DAY_W + DAY_W / 2, dropY);
  if (outline !== 'dashed') bad('рядок не підсвітився під час dragover — dragstart не поклав бронь у стан');
  const afterBusy = await placements();
  const moved = [...afterBusy].filter(([id, v]) => before.get(id) && before.get(id).at !== v.at);
  if (moved.length) bad(`кидок на зайняте місце переніс ${moved.length} бронь(ей) — мав відмовити`);
  else ok('кидок на зайняте місце нічого не змінив');
  const toast = await page.locator('div').filter({ hasText: /❌/ }).last().textContent().catch(() => null);
  if (toast && /зайнят|закрит/i.test(toast)) ok(`і назвав причину: «${toast.replace('❌', '').trim()}»`);
  else bad('відмова без причини: користувач не бачить, чому смуга не поїхала');
}

// ── 2–3. Кидок на вільне місце ────────────────────────────────────────────
const nightsText = (await barH.evaluate((el) => el.textContent)) || '';
const nights = Number((nightsText.match(/(\d+)\s*н\./) || [])[1]) || 3;
const start = await freeRun(nights);
if (start < 0) {
  bad(`у рядку немає вільного відрізка на ${nights} ноч. — перенести нікуди, прохід нічого не довів`);
} else {
  await dragTo(targetBox.x + start * DAY_W + DAY_W / 2, dropY);
  const after = await placements();
  const moved = [...after].filter(([id, v]) => before.get(id) && before.get(id).at !== v.at);
  if (moved.length !== 1) {
    bad(`перенеслось ${moved.length} броней замість однієї`);
  } else {
    const [id, now] = moved[0];
    const was = before.get(id);
    ok(`бронь ${id}: ${was.at} → ${now.at}`);
    if (now.nights !== was.nights) bad(`ночей було ${was.nights}, стало ${now.nights} — перетягування розтягнуло бронь (Д14)`);
    else ok(`ночей лишилось ${now.nights} — це перенесення, не розтягування`);
    if (now.unit_id === was.unit_id && now.check_in === was.check_in) bad('місце не змінилось');

    // ── Прибрати за собою: бронь повертається туди, звідки її взяли ───────
    const back = await api(`/api/bookings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ unit_id: was.unit_id, check_in: was.check_in, check_out: was.check_out, nights: was.nights }),
    });
    const restored = (await placements()).get(id);
    if (back.ok && restored && restored.at === was.at) ok('бронь повернуто на початкове місце');
    else bad(`бронь НЕ повернуто (${back.status}): лишилась на ${restored ? restored.at : '?'} замість ${was.at}`);
  }
}

await browser.close();

if (fails.length) {
  console.log(`\nпланер: ${fails.length} червоних`);
  process.exit(1);
}
console.log('\nпланер: перетягування переносить бронь, зайняте місце відмовляє з причиною, ночі не міняються');
