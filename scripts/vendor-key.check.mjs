/**
 * Зіпсований ключ вендора називається словами, а не стеком із чужих нутрощів.
 *
 *   node scripts/vendor-key.check.mjs
 *
 * Живий прохід 07.09 (Ж2): `CHANNEX_API_KEY` з неASCII-значенням валив
 * `channex-ari-live.mjs` усередині undici — «Cannot convert argument to a
 * ByteString», за десяток кадрів від причини. Оператор бачив падіння клієнта
 * і не бачив, що зіпсоване оточення.
 *
 * Осі (інваріант 26): чотири роди зіпсутості — перенос рядка, кирилиця,
 * пробіл, керівний символ — і РІЗНІ позиції (1 і далі), бо «завжди перший
 * символ» на однакових позиціях лишалося б зеленим; плюс валідні ключі
 * (hex, base64url), які мусять проходити.
 */
import assert from 'node:assert';
import { badKeyChar } from './lib/vendor-key.mjs';

// ── 1. Здорові ключі проходять ────────────────────────────────────────────
for (const ok of [
  '0a1b2c3d4e5f60718293a4b5c6d7e8f9',
  'sk_live_AbCdEf-1234_XYZ',
  'YWxpc2lvLXRlc3Qta2V5',
]) {
  assert.strictEqual(badKeyChar(ok), null, `здоровий ключ мусить проходити: ${ok}`);
}

// ── 2. Кожен рід зіпсутості названий, і названий СВОЇМ словом ─────────────
const cases = [
  ['abc\n', 'перенос рядка', 4],
  ['abc\r', 'повернення каретки', 4],
  ['ab cd', 'пробіл', 3],
  ['\tabc', 'табуляція', 1],
  ['ключ', 'неASCII-символ U+043A', 1],
  ['abcé', 'неASCII-символ U+00E9', 4],
  ['ab\u0001c', 'керівний символ U+0001', 3],
];
for (const [value, what, position] of cases) {
  const bad = badKeyChar(value);
  assert.ok(bad, `«${JSON.stringify(value)}» мусить бути відхилений`);
  assert.strictEqual(bad.what, what, `рід названо неправильно для ${JSON.stringify(value)}: ${bad.what}`);
  assert.strictEqual(bad.position, position,
    `позиція мусить бути ${position}, а не ${bad.position} — інакше оператор шукає не там`);
}

// ── 3. Позиції РІЗНІ, інакше твердження вище нічого не про них ────────────
const positions = new Set(cases.map(([, , p]) => p));
assert.ok(positions.size > 1, 'фікстура вироджена: усі помилки на одній позиції');

console.log('vendor-key: зіпсований ключ названо родом і позицією; здоровий проходить');
