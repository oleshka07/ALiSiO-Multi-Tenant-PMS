#!/usr/bin/env node
/**
 * Обхід чужого веб-застосунку під вашою сесією — читанням, без кліків, які пишуть.
 *
 * Навіщо. Дослідити сотню екранів налаштувань руками неможливо, а половина
 * вмісту SPA взагалі не існує, доки не клацнеш вкладку: дані вкладки тягнуться
 * при відкритті. Тож обхід має бути машинним, і машина має відкривати вкладки.
 *
 * Що знімає з кожного екрана:
 *   - мережу (JSON-відповіді) → HAR, з якого scripts/har-digest.mjs робить схему;
 *   - знімок повної висоти → дизайн і компонування;
 *   - опис інтерфейсу → підписи, поля, типи, ОПЦІЇ СПИСКІВ, підказки, вкладки,
 *     заголовки таблиць, порожні стани. Це і є юзабіліті в машиночитаній формі.
 *
 * Сесія. Профіль браузера свій (`--profile`), і логінитесь ви руками ОДИН раз:
 *
 *   node scripts/site-crawl.mjs --start https://app.example.com/ --login
 *   node scripts/site-crawl.mjs --start https://app.example.com/
 *
 * Chrome від версії 136 не дає під'єднатись налагоджувачем до основного
 * профілю, тому окремий профіль — не примха, а єдиний робочий шлях. Заразом
 * ваш звичайний браузер лишається незайманим.
 *
 * ЧИТАННЯ, НЕ ЗАПИС. Клікає лише вкладки й розкривачки. Кнопки, підписи яких
 * схожі на «зберегти», «видалити», «надіслати», «оплатити», «вийти», не
 * чіпає ніколи (DANGER), форми не надсилає, за межі свого походження не
 * ходить. Між сторінками пауза: це дослідження, а не навантаження.
 */

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SENSITIVE_SOURCE } from './lib/sensitive-names.mjs';

// ── налаштування ────────────────────────────────────────────────────────────

const DEFAULTS = {
  out: 'capture',
  profile: '.crawl-profile',
  max: 250,
  delay: 1200,
  timeout: 30000,
};

/** Підписи, на які не клікаємо ніколи. Вихід — окремо: він убиває сесію. */
const DANGER =
  /(зберегти|save|видал|delete|remove|надісл|send|submit|оплат|pay|charge|publish|опубл|підтверд|confirm|скасув|cancel|вийти|logout|sign out|log out|деактив|deactivate|archive|архів|експорт|export|імпорт|import|invite|запрос|створ|create|add|додати|new|нов)/i;


// ── аргументи ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opts = { ...DEFAULTS, start: null, login: false, headless: false, extraHosts: [], browser: null };

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const next = () => argv[(i += 1)];
  if (a === '--start') opts.start = next();
  else if (a === '--out') opts.out = next();
  else if (a === '--profile') opts.profile = next();
  else if (a === '--max') opts.max = Number(next());
  else if (a === '--delay') opts.delay = Number(next());
  else if (a === '--host') opts.extraHosts.push(next());
  else if (a === '--browser') opts.browser = next();
  else if (a === '--login') opts.login = true;
  else if (a === '--headless') opts.headless = true;
  else {
    console.error(`Невідомий аргумент: ${a}`);
    process.exit(1);
  }
}

if (!opts.start) {
  console.error('Вкажіть --start <url>, напр. --start https://app.example.com/');
  process.exit(1);
}

const startUrl = new URL(opts.start);
const allowedHosts = new Set([startUrl.host, ...opts.extraHosts]);

const dirs = {
  root: opts.out,
  shots: join(opts.out, 'shots'),
  pages: join(opts.out, 'pages'),
};
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

// ── опис інтерфейсу: виконується всередині сторінки ─────────────────────────

/**
 * Збирає структуру екрана. Значення текстових полів НЕ читаємо: у робочому
 * акаунті там дані готелю і гостей. Підписи, типи й опції списків — читаємо,
 * бо саме вони описують модель налаштувань.
 */
function extractInventory(sensitiveSource) {
  const SENS = new RegExp(sensitiveSource, 'i');
  const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const labelFor = (el) => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim().slice(0, 160);
    const id = el.getAttribute('id');
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab) return text(lab);
    }
    const wrap = el.closest('label');
    if (wrap) return text(wrap);
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      const node = document.getElementById(labelled);
      if (node) return text(node);
    }
    // остання спроба: найближчий текст перед полем
    const prev = el.previousElementSibling;
    if (prev && /label|span|div|p|h\d/i.test(prev.tagName)) return text(prev);
    return '';
  };

  const fields = [];
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!visible(el)) continue;
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    if (type === 'hidden') continue;
    const name = el.getAttribute('name') || el.getAttribute('id') || '';
    const field = {
      label: labelFor(el),
      name,
      type,
      required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      placeholder: el.getAttribute('placeholder') || undefined,
    };
    if (type === 'checkbox' || type === 'radio') field.checked = el.checked;
    if (el.tagName === 'SELECT') {
      // опції списку — це перелік допустимих значень, найцінніше на екрані
      field.options = [...el.options].slice(0, 60).map((o) => ({
        value: o.value.slice(0, 80),
        label: text(o),
      }));
      field.selected = el.selectedIndex >= 0 ? el.options[el.selectedIndex]?.value : undefined;
    }
    if (SENS.test(name) || SENS.test(field.label)) field.sensitive = true;
    fields.push(field);
  }

  const switches = [...document.querySelectorAll('[role="switch"], [role="checkbox"]')]
    .filter(visible)
    .map((el) => ({
      label: labelFor(el) || text(el),
      on: el.getAttribute('aria-checked') === 'true',
    }));

  const tabs = [...document.querySelectorAll('[role="tab"]')].filter(visible).map((el) => ({
    label: text(el),
    selected: el.getAttribute('aria-selected') === 'true',
  }));

  const headings = [...document.querySelectorAll('h1, h2, h3')]
    .filter(visible)
    .map((el) => ({ level: Number(el.tagName[1]), text: text(el) }))
    .filter((h) => h.text);

  const nav = [...document.querySelectorAll('nav a, aside a, [role="navigation"] a')]
    .filter(visible)
    .map((el) => ({ text: text(el), href: el.getAttribute('href') }))
    .filter((n) => n.text);

  const buttons = [...document.querySelectorAll('button, [role="button"], a.btn')]
    .filter(visible)
    .map((el) => text(el))
    .filter(Boolean)
    .slice(0, 120);

  // таблиці: тільки заголовки і кількість рядків. Вміст комірок — це дані
  // готелю і гостей, він нам не потрібен і не має тут опинятися.
  const tables = [...document.querySelectorAll('table')].filter(visible).map((t) => ({
    columns: [...t.querySelectorAll('thead th, thead td')].map(text).filter(Boolean),
    rows: t.querySelectorAll('tbody tr').length,
  }));

  const hints = [...document.querySelectorAll('[class*="hint"], [class*="help"], [class*="desc"], small, [role="tooltip"]')]
    .filter(visible)
    .map(text)
    .filter((s) => s.length > 3)
    .slice(0, 60);

  return {
    title: document.title,
    headings,
    tabs,
    fields,
    switches,
    buttons,
    tables,
    hints,
    nav,
    links: [...document.querySelectorAll('a[href]')]
      .map((a) => a.href)
      .filter(Boolean),
  };
}

// ── допоміжне ───────────────────────────────────────────────────────────────

const slugify = (url) => {
  const u = new URL(url);
  const s = `${u.pathname}${u.search}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return (s || 'root').slice(0, 90);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Запис мережі у формі HAR — щоб har-digest.mjs їв і це, і ручний експорт. */
const harEntries = [];

function recordResponse(res) {
  const req = res.request();
  const mime = (res.headers()['content-type'] ?? '').split(';')[0];
  const entry = {
    _resourceType: req.resourceType(),
    request: { method: req.method(), url: req.url() },
    response: { status: res.status(), content: { mimeType: mime } },
  };
  const post = req.postData();
  if (post) entry.request.postData = { text: post.slice(0, 200000) };
  return { entry, mime, res };
}

// ── головне ─────────────────────────────────────────────────────────────────

const context = await chromium.launchPersistentContext(opts.profile, {
  headless: opts.headless,
  viewport: { width: 1440, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
  ...(opts.browser ? { executablePath: opts.browser } : {}),
});

const page = context.pages()[0] ?? (await context.newPage());

if (opts.login) {
  await page.goto(opts.start, { waitUntil: 'domcontentloaded' }).catch(() => {});
  console.log('');
  console.log('Вікно відкрито. Увійдіть в акаунт руками, дійдіть до головного');
  console.log('екрана застосунку — і поверніться сюди натиснути Enter.');
  console.log('Сесія лишиться в профілі, наступні запуски логіна не потребують.');
  console.log('');
  await new Promise((resolve) => process.stdin.once('data', resolve));
  await context.close();
  console.log('Профіль збережено. Тепер запускайте без --login.');
  process.exit(0);
}

// мережу збираємо через слухач, який живе весь обхід
page.on('response', async (res) => {
  try {
    const { entry, mime } = recordResponse(res);
    if (/json/i.test(mime)) {
      const body = await res.text().catch(() => null);
      if (body) entry.response.content.text = body.slice(0, 400000);
    }
    harEntries.push(entry);
  } catch {
    /* відповідь могла зникнути разом зі сторінкою — не привід падати */
  }
});

const queue = [opts.start];
const seen = new Set();
const index = [];
let visited = 0;

console.log(`Старт: ${opts.start}`);
console.log(`Дозволені хости: ${[...allowedHosts].join(', ')}`);
console.log(`Стеля: ${opts.max} сторінок, пауза ${opts.delay} мс.`);
console.log('');

while (queue.length && visited < opts.max) {
  const url = queue.shift();
  const key = url.split('#')[0];
  if (seen.has(key)) continue;
  seen.add(key);

  let inv;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeout });
    await page.waitForLoadState('networkidle', { timeout: opts.timeout }).catch(() => {});
    await sleep(400);
    inv = await page.evaluate(extractInventory, SENSITIVE_SOURCE);
  } catch (err) {
    console.log(`  ✗ ${url} — ${err.message.split('\n')[0]}`);
    index.push({ url, error: err.message.split('\n')[0] });
    continue;
  }

  visited += 1;
  const slug = slugify(url);
  const record = { url, slug, captured: new Date().toISOString(), main: inv, tabs: [] };

  await page
    .screenshot({ path: join(dirs.shots, `${slug}.png`), fullPage: true })
    .catch(() => {});

  // Вкладки: у SPA вміст невідкритої вкладки не існує ні в DOM, ні в мережі.
  const tabHandles = await page.$$('[role="tab"]');
  for (let t = 0; t < tabHandles.length && t < 12; t += 1) {
    const handle = tabHandles[t];
    const label = (await handle.textContent().catch(() => ''))?.trim().slice(0, 80) ?? '';
    if (!label || DANGER.test(label)) continue;
    if ((await handle.getAttribute('aria-selected')) === 'true') continue;
    try {
      await handle.click({ timeout: 5000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await sleep(300);
      const tabInv = await page.evaluate(extractInventory, SENSITIVE_SOURCE);
      record.tabs.push({ label, inventory: tabInv });
      await page
        .screenshot({ path: join(dirs.shots, `${slug}--tab-${t}.png`), fullPage: true })
        .catch(() => {});
    } catch {
      /* вкладка могла перемалюватись — наступна */
    }
  }

  // Розкривачки: те саме, лише інший елемент.
  for (const sel of ['details:not([open]) > summary', '[aria-expanded="false"]']) {
    const handles = await page.$$(sel);
    for (const h of handles.slice(0, 15)) {
      const label = (await h.textContent().catch(() => ''))?.trim() ?? '';
      if (DANGER.test(label)) continue;
      await h.click({ timeout: 3000 }).catch(() => {});
    }
  }
  if (await page.$('[aria-expanded="true"], details[open]')) {
    await sleep(400);
    record.expanded = await page.evaluate(extractInventory, SENSITIVE_SOURCE);
    await page
      .screenshot({ path: join(dirs.shots, `${slug}--expanded.png`), fullPage: true })
      .catch(() => {});
  }

  writeFileSync(join(dirs.pages, `${slug}.json`), JSON.stringify(record, null, 2));
  index.push({ url, slug, title: inv.title, tabs: record.tabs.map((t) => t.label) });
  console.log(`  ${String(visited).padStart(3)} ✓ ${url}${record.tabs.length ? ` (+${record.tabs.length} вкл.)` : ''}`);

  // нові адреси — лише свої, лише ті, що ще не бачили
  const found = new Set([...inv.links, ...record.tabs.flatMap((t) => t.inventory.links ?? [])]);
  for (const href of found) {
    let u;
    try {
      u = new URL(href, url);
    } catch {
      continue;
    }
    if (!allowedHosts.has(u.host)) continue;
    if (!/^https?:$/.test(u.protocol)) continue;
    if (/\.(png|jpe?g|gif|svg|ico|css|js|woff2?|pdf|zip)$/i.test(u.pathname)) continue;
    if (DANGER.test(u.pathname)) continue;
    const clean = `${u.origin}${u.pathname}${u.search}`;
    if (!seen.has(clean)) queue.push(clean);
  }

  await sleep(opts.delay);
}

writeFileSync(
  join(dirs.root, 'network.har'),
  JSON.stringify({ log: { version: '1.2', creator: { name: 'site-crawl' }, entries: harEntries } }),
);
writeFileSync(
  join(dirs.root, 'index.json'),
  JSON.stringify({ start: opts.start, visited, queued: queue.length, pages: index }, null, 2),
);

await context.close();

console.log('');
console.log(`Сторінок знято: ${visited}${queue.length ? `, у черзі лишилось ${queue.length} (стеля --max)` : ''}`);
console.log(`Запитів у мережі: ${harEntries.length}`);
console.log('');
console.log('Далі:');
console.log(`  node scripts/har-digest.mjs ${join(dirs.root, 'network.har')} --out digest.json --md digest.md`);
console.log(`  ${dirs.pages}/*.json — опис екранів, ${dirs.shots}/ — знімки`);
