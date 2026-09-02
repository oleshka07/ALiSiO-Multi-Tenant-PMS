/**
 * Поле чужої відповіді, на яке спирається код, побачене живим хоч раз.
 *
 *   node scripts/check-live-fields.mjs [--strict]
 *
 * Інваріант 28 (AGENTS §3). Три твердження:
 *
 *   1. кожне поле з реєстру `live-fields.json` є хоча б в одному живому
 *      зразку свого ендпоінта (`docs/vendor/channex/live/`);
 *   2. ендпоінт без жодного зразка — або названо, чого він чекає
 *      (`awaiting`), або це червоне; поле, якого зразок не показує, бо стану
 *      ще немає (порожня стрічка, жодного каналу), — `awaiting_fields`;
 *   3. імʼя, яке клієнт читає з відповіді (`payload.x`, `.attributes.x`,
 *      `meta.x`, `data.x`), значиться в реєстрі — інакше реєстр брехав би
 *      про повноту.
 *
 * Шлях поля: `data.attributes.is_active`, `data[].id`, `meta.warnings[].date`
 * — `[]` означає «будь-який елемент». Поле присутнє, якщо існує (не
 * `undefined`); `null` — присутнє: вендор його віддає.
 *
 * Перевірка вирізає коментарі з коду перед пошуком (AGENTS §4).
 */
import fs from 'node:fs';
import path from 'node:path';

const strict = process.argv.includes('--strict');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REGISTRY = path.join(ROOT, 'src/modules/channels/channex/live-fields.json');
const SAMPLES = path.join(ROOT, 'docs/vendor/channex/live');
const CLIENT = path.join(ROOT, 'src/modules/channels/channex/client.ts');

const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
const files = fs.existsSync(SAMPLES) ? fs.readdirSync(SAMPLES).filter((f) => f.endsWith('.json')) : [];

function slugOf(endpoint) {
  const [method, template] = endpoint.split(' ');
  return `${method}__${template.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')}__`;
}

function present(value, segments) {
  if (segments.length === 0) return value !== undefined;
  const [head, ...rest] = segments;
  if (head.endsWith('[]')) {
    const arr = value?.[head.slice(0, -2)];
    return Array.isArray(arr) && arr.some((el) => present(el, rest));
  }
  // `{}` — будь-який ключ обʼєкта: календар вендора індексований
  // ідентифікаторами опцій і датами (`data{}.{}.rate`), а не сталими іменами.
  if (head.endsWith('{}')) {
    const obj = head === '{}' ? value : value?.[head.slice(0, -2)];
    return !!obj && typeof obj === 'object' && !Array.isArray(obj) && Object.values(obj).some((el) => present(el, rest));
  }
  if (value === null || typeof value !== 'object') return false;
  return present(value[head], rest);
}

const failures = [];
const waiting = [];
let checked = 0;

for (const [endpoint, entry] of Object.entries(registry)) {
  const slug = slugOf(endpoint);
  const samples = files.filter((f) => f.startsWith(slug)).map((f) => JSON.parse(fs.readFileSync(path.join(SAMPLES, f), 'utf8')));
  if (samples.length === 0) {
    if (entry.awaiting) waiting.push(`${endpoint} — чекає: ${entry.awaiting}`);
    else failures.push(`${endpoint}: жодного живого зразка і не сказано, чого він чекає`);
    continue;
  }
  const awaitingFields = entry.awaiting_fields ?? {};
  for (const field of entry.fields ?? []) {
    checked++;
    const segments = field.split('.');
    if (samples.some((s) => present(s.payload, segments))) continue;
    // Поле, якого зразок не показує, бо стану ще немає (порожня стрічка,
    // жодного каналу) — назване очікування, не червоне. Без назви — червоне.
    const reason = awaitingFields[field] ?? awaitingFields['*'];
    if (reason) waiting.push(`${endpoint} · ${field} — чекає: ${reason}`);
    else failures.push(`${endpoint}: поле «${field}» не бачене в жодному з ${samples.length} зразків — код читає те, чого вендор не віддає`);
  }
}

// ── 3. Реєстр повний: імена, які клієнт читає з відповіді ────────────────
const src = fs.readFileSync(CLIENT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// Зареєстровані — УСІ сегменти шляхів, не лише останні: `rate_plans[].rate_plan_id`
// реєструє і `rate_plans`, бо клієнт читає його як масив дорогою до листка.
const registered = new Set(Object.values(registry).flatMap((e) => (e.fields ?? []).flatMap((f) => f.split('.').map((seg) => seg.replace('[]', '').replace('{}', '')))));
// Конверт JSON:API і наші власні поля обгортки — не поля даних.
const ENVELOPE = new Set(['data', 'meta', 'errors', 'attributes', 'code', 'title', 'details', 'id', 'type']);
// Члени масиву й рядка JS, а не поля відповіді.
const JS_MEMBERS = new Set(['map', 'length', 'filter', 'some', 'every', 'slice', 'join', 'find', 'flatMap', 'forEach', 'reduce', 'includes', 'at']);
const read = new Set();
for (const m of src.matchAll(/\b(?:payload|meta|data|attributes|d|row|w)\??\.(\w+)/g)) read.add(m[1]);
for (const m of src.matchAll(/\.attributes\??\.(\w+)/g)) read.add(m[1]);
for (const name of read) {
  if (ENVELOPE.has(name) || JS_MEMBERS.has(name)) continue;
  if (!registered.has(name)) failures.push(`client.ts читає з відповіді «${name}», а в реєстрі live-fields.json його немає`);
}

console.log(`live fields: ${checked} полів у ${Object.keys(registry).length} ендпоінтах, зразків ${files.length}`);
for (const w of waiting) console.log(`  ⏳ ${w}`);
if (failures.length) {
  console.log(`✗ інваріант 28 — поле, не бачене живим:\n${failures.map((f) => `  ${f}`).join('\n')}`);
  if (strict) process.exit(1);
} else {
  console.log('✓ кожне поле, на яке спирається код, бачене в живій відповіді; реєстр повний');
}
