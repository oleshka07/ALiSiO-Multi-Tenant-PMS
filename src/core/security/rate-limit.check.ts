/**
 * Ліміт публічних маршрутів справді рахує.
 *
 *   node src/core/security/rate-limit.check.ts
 *
 * ── Що тут ловиться ─────────────────────────────────────────────────────
 *
 * `checkRateLimit` рахувала спроби так:
 *
 *     WHERE created_at > ?          -- відсічка: '2026-08-27T19:29:22.323Z'
 *
 * а писала їх так:
 *
 *     created_at TEXT NOT NULL DEFAULT (datetime('now'))   -- '2026-08-27 19:34:12'
 *
 * У SQLite обидва — TEXT, і порівняння посимвольне: пробіл (0x20) менший за
 * `T` (0x54), тож будь-який збережений рядок «старіший» за будь-яку відсічку.
 * COUNT завжди нуль, ліміт не спрацьовує ніколи. На Postgres колонка
 * `TIMESTAMPTZ`, параметр приводиться до часу — і там усе працювало.
 *
 * Тобто захист публічних маршрутів гостьового порталу (замовлення послуг,
 * реєстрація гостя, запит рахунку) стояв на проді й не стояв на кожній машині
 * розробника, під `npm run dev` і в завданні `live` у CI. Помітити це можна
 * було лише зловживанням: усі відповіді 200, у таблиці рядки є, а лічильник
 * бачить нуль.
 *
 * Перевірка гоняє справжню SQLite і справжню функцію: четвертий запит при
 * ліміті 3 мусить бути відхилений, а після вікна — знову дозволений.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-rl-'));
process.env.ALISIO_DATA_DIR = tmp;

const { checkRateLimit } = await import('./rate-limit.ts');

const TOKEN = 'probe-token';

// ── Ліміт 3 на 10 хвилин ────────────────────────────────────────────────
for (let i = 1; i <= 3; i++) {
  const r = await checkRateLimit(TOKEN, 'registration', 3, 10);
  assert.ok(r.allowed, `спроба ${i} з 3 відхилена — ліміт рахує зайве`);
  assert.strictEqual(r.remaining, 3 - i, `після спроби ${i} лишилось ${r.remaining}, а мало ${3 - i}`);
}

const fourth = await checkRateLimit(TOKEN, 'registration', 3, 10);
assert.strictEqual(fourth.allowed, false,
  'четверта спроба при ліміті 3 пройшла — саме так виглядав баг із форматом дати: COUNT завжди нуль');
console.log('  ok  четверта спроба при ліміті 3 відхилена');

// ── Інший токен і інша дія рахуються окремо ─────────────────────────────
//
// Ключ складений із двох половин, і склеїти їх в одну — це або спільне відро
// на всіх гостей (один гість вичерпує ліміт усім), або окреме відро на кожну
// друкарську помилку в назві дії (ліміту немає взагалі).
const otherToken = await checkRateLimit('another-token', 'registration', 3, 10);
assert.ok(otherToken.allowed, 'ліміт одного гостя перекрив іншого — відро спільне');

const otherAction = await checkRateLimit(TOKEN, 'service_order', 3, 10);
assert.ok(otherAction.allowed, 'спроби різних дій потрапили в одне відро');
console.log('  ok  токен і дія — окремі лічильники');

// ── Вікно рухається ─────────────────────────────────────────────────────
//
// Той самий вичерпаний токен із НУЛЬОВИМ вікном: усі попередні спроби вже
// позаду відсічки, тож рахувати нема чого. Так перевіряється, що обмежує саме
// вікно, а не «назавжди після N спроб».
const afterWindow = await checkRateLimit(TOKEN, 'registration', 3, 0);
assert.ok(afterWindow.allowed,
  'спроби поза вікном усе ще рахуються — ліміт не відпускає ніколи');
console.log('  ok  поза вікном спроби не рахуються');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('  ok  rate-limit: ліміт публічних маршрутів справді рахує');
