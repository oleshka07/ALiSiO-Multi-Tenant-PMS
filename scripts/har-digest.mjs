#!/usr/bin/env node
/**
 * HAR → компактний дайджест API чужого сервісу.
 *
 * Навіщо. Запис мережі з DevTools (`Save all as HAR with content`) — це 20–200 МБ,
 * усередині яких лежать cookie сесії, Bearer-токени і персональні дані гостей.
 * Такий файл не можна ні комітити, ні передавати. Але потрібна з нього лише
 * ФОРМА даних: які є ендпоінти, які поля, яких типів, які значення бувають у
 * полів-переліків. Цей скрипт лишає форму і викидає значення.
 *
 * Запускати ЛОКАЛЬНО, на машині, де знято HAR. У репозиторій їде тільки вивід.
 *
 *   node scripts/har-digest.mjs capture/*.har --out digest.json --md digest.md
 *
 * Що робить:
 *   - лишає лише JSON-відповіді (XHR/fetch), решту рахує як статистику;
 *   - нормалізує шлях: /api/rooms/9f3e-…/rates → /api/rooms/:id/rates;
 *   - зводить усі відповіді одного ендпоінта в одну схему (об'єднання полів);
 *   - для коротких рядків збирає кандидатів у перелік (statuses, currency, …);
 *   - значення полів з чутливими іменами не показує — лише тип;
 *   - заголовки викидає повністю, крім content-type.
 *
 * Дайджест НЕ є гарантією відсутності персональних даних: якщо сервіс назвав
 * колонку `note`, а в ній лежить прізвище гостя — воно потрапить у зразок.
 * Перед тим як комітити, вивід читається очима. Це п'ять хвилин.
 */

import { readFileSync, writeFileSync } from 'node:fs';

/** Імена полів, значення яких не показуємо ніколи — лише тип. */
const SENSITIVE = /(token|password|passwd|secret|api[-_]?key|authorization|session|cookie|signature|iban|bic|card|cvv|pan|email|phone|tel|mobile|passport|birth|dob|ssn|vat[-_]?number|ico|dic|address|street|zip|postal|lat|lng|longitude|latitude|note|comment|message|firstname|lastname|surname|fullname|guest[-_]?name)/i;

/** Скільки різних значень збирати, поки поле ще схоже на перелік. */
const ENUM_LIMIT = 12;
/** Довші рядки — це текст, не перелік. */
const ENUM_MAX_LEN = 48;
/** Скільки елементів масиву дивитись (решта тієї самої форми). */
const ARRAY_SAMPLE = 3;
/** Глибина, нижче якої форма вже не цікава. */
const MAX_DEPTH = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEXID = /^[0-9a-f]{16,}$/i;
const NUMID = /^\d+$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeSegment(seg) {
  if (UUID.test(seg) || HEXID.test(seg) || ULID.test(seg)) return ':id';
  if (NUMID.test(seg)) return ':id';
  if (DATE.test(seg)) return ':date';
  return seg;
}

function normalizePath(pathname) {
  return pathname.split('/').map(normalizeSegment).join('/');
}

/** Опис одного значення: тип + (для коротких рядків) кандидати в перелік. */
function describe(value, key, depth) {
  if (depth > MAX_DEPTH) return { type: 'deep' };
  if (value === null) return { type: 'null' };

  if (Array.isArray(value)) {
    const node = { type: 'array', items: null, seen: value.length };
    for (const item of value.slice(0, ARRAY_SAMPLE)) {
      node.items = merge(node.items, describe(item, key, depth + 1));
    }
    return node;
  }

  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = describe(v, k, depth + 1);
    }
    return { type: 'object', fields };
  }

  const type = typeof value;
  const node = { type };

  // Значення показуємо лише там, де воно пояснює модель даних, а не описує людину.
  if (key && SENSITIVE.test(key)) {
    node.redacted = true;
    return node;
  }
  if (type === 'string') {
    if (value.length <= ENUM_MAX_LEN) node.values = new Set([value]);
    else node.long = true;
  } else if (type === 'number' || type === 'boolean') {
    node.values = new Set([value]);
  }
  return node;
}

/** Об'єднання двох описів: поле, якого немає в одній з відповідей, стає optional. */
function merge(a, b) {
  if (!a) return b;
  if (!b) return a;

  if (a.type === 'object' && b.type === 'object') {
    const fields = {};
    const keys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
    for (const k of keys) {
      const left = a.fields[k];
      const right = b.fields[k];
      const merged = merge(left, right);
      if (!left || !right) merged.optional = true;
      fields[k] = merged;
    }
    return { type: 'object', fields };
  }

  if (a.type === 'array' && b.type === 'array') {
    return {
      type: 'array',
      items: merge(a.items, b.items),
      seen: Math.max(a.seen ?? 0, b.seen ?? 0),
    };
  }

  if (a.type === b.type) {
    const node = { type: a.type };
    if (a.redacted || b.redacted) node.redacted = true;
    if (a.long || b.long) node.long = true;
    if (a.values || b.values) {
      const values = new Set([...(a.values ?? []), ...(b.values ?? [])]);
      if (values.size <= ENUM_LIMIT) node.values = values;
      else node.many = values.size;
    }
    if (a.optional || b.optional) node.optional = true;
    return node;
  }

  // Різні типи — найчастіше nullable-поле.
  const types = new Set([
    ...(a.type === 'union' ? a.types : [a.type]),
    ...(b.type === 'union' ? b.types : [b.type]),
  ]);
  return { type: 'union', types: [...types], optional: a.optional || b.optional };
}

function parseJson(text) {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isJsonMime(mime = '') {
  return /json/i.test(mime);
}

// ── збір ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const files = [];
let outJson = 'digest.json';
let outMd;

// Прапорці зі значенням розбираються послідовно: інакше значення `--out`
// потрапляє у список вхідних файлів і скрипт намагається читати власний вивід.
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--out') {
    outJson = args[i + 1];
    i += 1;
  } else if (arg === '--md') {
    outMd = args[i + 1];
    i += 1;
  } else if (arg.startsWith('--')) {
    console.error(`Невідомий прапорець: ${arg}`);
    process.exit(1);
  } else {
    files.push(arg);
  }
}

if (!outJson) {
  console.error('--out потребує імені файла');
  process.exit(1);
}

if (files.length === 0) {
  console.error('Вкажіть хоча б один .har: node scripts/har-digest.mjs capture/*.har');
  process.exit(1);
}

/** ендпоінт → зведення */
const endpoints = new Map();
/** навігації сторінок — карта розділів застосунку */
const pages = new Map();
/** усе, що не JSON — лише лічильники, щоб бачити стек і CDN */
const assets = new Map();
let skippedNonJson = 0;

for (const file of files) {
  let har;
  try {
    har = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Не читається ${file}: ${err.message}`);
    process.exit(1);
  }

  for (const entry of har?.log?.entries ?? []) {
    const req = entry.request;
    const res = entry.response;
    if (!req?.url) continue;

    let url;
    try {
      url = new URL(req.url);
    } catch {
      continue;
    }

    const mime = res?.content?.mimeType ?? '';
    const resourceType = entry._resourceType ?? '';

    if (resourceType === 'document' || /text\/html/i.test(mime)) {
      const key = `${url.host}${normalizePath(url.pathname)}`;
      pages.set(key, (pages.get(key) ?? 0) + 1);
      continue;
    }

    if (!isJsonMime(mime)) {
      const kind = resourceType || mime.split(';')[0] || 'unknown';
      assets.set(kind, (assets.get(kind) ?? 0) + 1);
      skippedNonJson += 1;
      continue;
    }

    const key = `${req.method} ${url.host}${normalizePath(url.pathname)}`;
    let ep = endpoints.get(key);
    if (!ep) {
      ep = {
        method: req.method,
        host: url.host,
        path: normalizePath(url.pathname),
        calls: 0,
        statuses: new Set(),
        query: new Set(),
        request: null,
        response: null,
      };
      endpoints.set(key, ep);
    }

    ep.calls += 1;
    if (res?.status) ep.statuses.add(res.status);
    for (const k of url.searchParams.keys()) ep.query.add(k);

    const reqBody = parseJson(req.postData?.text);
    if (reqBody !== undefined) {
      ep.request = merge(ep.request, describe(reqBody, null, 0));
    }

    const resBody = parseJson(res?.content?.text);
    if (resBody !== undefined) {
      ep.response = merge(ep.response, describe(resBody, null, 0));
    }
  }
}

// ── вивід ───────────────────────────────────────────────────────────────────

function plain(node) {
  if (!node) return null;
  const out = { type: node.type };
  if (node.optional) out.optional = true;
  if (node.redacted) out.redacted = true;
  if (node.long) out.long = true;
  if (node.many) out.distinct = node.many;
  if (node.types) out.types = node.types;
  if (node.values) out.values = [...node.values].sort();
  if (node.type === 'object') {
    out.fields = Object.fromEntries(
      Object.entries(node.fields)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, plain(v)]),
    );
  }
  if (node.type === 'array') {
    out.items = plain(node.items);
    if (node.seen) out.seen = node.seen;
  }
  return out;
}

const list = [...endpoints.values()].sort(
  (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
);

const digest = {
  generated: new Date().toISOString().slice(0, 10),
  sources: files.length,
  endpoints: list.map((ep) => ({
    method: ep.method,
    host: ep.host,
    path: ep.path,
    calls: ep.calls,
    statuses: [...ep.statuses].sort(),
    query: [...ep.query].sort(),
    request: plain(ep.request),
    response: plain(ep.response),
  })),
  pages: [...pages.entries()].sort().map(([path, hits]) => ({ path, hits })),
  assets: Object.fromEntries([...assets.entries()].sort()),
};

writeFileSync(outJson, JSON.stringify(digest, null, 2));

if (outMd) {
  const lines = ['# Дайджест API', '', `Ендпоінтів: ${list.length}. Сторінок: ${pages.size}.`, ''];
  lines.push('## Сторінки (карта розділів)', '');
  for (const [path, hits] of [...pages.entries()].sort()) lines.push(`- \`${path}\` ×${hits}`);
  lines.push('', '## Ендпоінти', '');
  for (const ep of list) {
    lines.push(`### \`${ep.method} ${ep.path}\``);
    lines.push('');
    lines.push(`Викликів: ${ep.calls}. Статуси: ${[...ep.statuses].join(', ')}.`);
    if (ep.query.size) lines.push(`Параметри: ${[...ep.query].sort().map((q) => `\`${q}\``).join(', ')}.`);
    lines.push('');
    if (ep.request) {
      lines.push('Тіло запиту:', '', '```json', JSON.stringify(plain(ep.request), null, 2), '```', '');
    }
    if (ep.response) {
      lines.push('Відповідь:', '', '```json', JSON.stringify(plain(ep.response), null, 2), '```', '');
    }
  }
  writeFileSync(outMd, lines.join('\n'));
}

console.log(`Ендпоінтів: ${list.length}`);
console.log(`Сторінок: ${pages.size}`);
console.log(`Пропущено не-JSON запитів: ${skippedNonJson}`);
console.log(`Записано: ${outJson}${outMd ? ` і ${outMd}` : ''}`);
console.log('');
console.log('Перед комітом прочитайте вивід очима: поле з нейтральною назвою');
console.log('може містити персональні дані, і скрипт цього не знає.');
