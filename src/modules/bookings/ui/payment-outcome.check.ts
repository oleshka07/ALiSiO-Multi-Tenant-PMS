/**
 * Прийом оплати: що САМЕ побачить портьє.
 *
 * ── Звідки фікстура ─────────────────────────────────────────────────────
 *
 * Тіла нижче не вигадані — це ДОСЛІВНІ відповіді `POST /api/payments`,
 * зняті живим прогоном 11.09.2026: прод-збірка, справжній Postgres 16, роль
 * `alisio_app` без суперправ, два готелі (Чехія CZK і Німеччина EUR),
 * заведені `provision-org.mjs`. Саме тому тут стоїть `folioRecorded`, а не
 * `folio_recorded`, і `error`, а не `detail`: форму взято з дроту, не з
 * памʼяті. Це той самий довід, що в інваріанті 28 — поле, від якого залежить
 * код, має бути побачене в живій відповіді.
 *
 * ── Вісь, по якій фікстура НЕ вироджена (інваріант 26) ──────────────────
 *
 * Вісь тут одна і головна: **чи можна показати підтвердження**. Тому в наборі
 * є ОБИДВА значення кожної осі, що на неї впливає:
 *
 *   `ok`            — true і false (201 і 409);
 *   `kind`          — 'marker' і 'fin_operation';
 *   `folioRecorded` — true, false і ВІДСУТНЄ (три стани, не два: відсутність
 *                     поля не означає відмови фоліо, і саме це переплутав би
 *                     звичайний `!b.folioRecorded`);
 *   текст від сервера — є і немає (тіло 409 без `error`).
 *
 * Очікуване несумісне з альтернативним прочитанням: якби функція судила лише
 * за `kind`, як судив екран, то ТРИ з семи випадків дали б `recorded` —
 * тобто підтвердження там, де грошей немає.
 */
import assert from 'node:assert';
import { paymentOutcome } from './payment-outcome.ts';

// ── Відмова: 409, немає каси в валюті броні ───────────────────────────────
//
// Це РІВНО той випадок, що стався на беті: готель, заведений до 08.09.2026,
// коли `provisionOrganization` ще не засівав касу.
const noTill = {
  error: 'У готелю немає активного рахунку в EUR, тож готівку нема куди записати. '
    + 'Додайте касу: Фінанси → Рахунки → Додати рахунок (тип «Каса», валюта EUR).',
};
const refused = paymentOutcome(false, noTill);
assert.strictEqual(refused.kind, 'refused', 'відмова не сміє читатись як запис');
assert.strictEqual(refused.kind === 'refused' && refused.message, noTill.error,
  'речення сервера їде дослівно: воно називає ВАЛЮТУ і шлях, яким це лагодять');

// Відмова без тіла — проксі, обрив, 502. Підтвердження все одно не сміє бути.
const bare = paymentOutcome(false, {});
assert.strictEqual(bare.kind, 'refused', 'відмова без тіла — все одно відмова');
assert.strictEqual(bare.kind === 'refused' && bare.message, null,
  'порожнього рядка в тост не їде: екран покаже власне запасне речення');
assert.strictEqual(paymentOutcome(false, null).kind, 'refused',
  'тіла може не бути взагалі (res.json() кинув) — судимо за статусом');

// ── Запис пройшов повністю: каса + рахунок гостя ──────────────────────────
assert.strictEqual(
  paymentOutcome(true, { id: 'inc_1', ok: true, kind: 'fin_operation', folioRecorded: true } as never).kind,
  'recorded', 'готівка, що лягла в обидві книги, — це підтвердження');

// ── Запис частковий: гроші в касі, у фоліо ні ─────────────────────────────
//
// Німецький обʼєкт без `fiscal_de`. 201, тобто на статус це НЕ схоже на
// проблему — і саме тому екран, що дивиться лише на статус, тут теж збрехав би.
const deBody = {
  id: 'inc_2', ok: true, kind: 'fin_operation', folioRecorded: false,
  folioRefusal: 'Cash and card payments for a German property are still recorded in the old till system'
    + ' — the fiscal module (TSE) is not enabled yet',
  message: 'Гроші записано в касу, але не в рахунок гостя — рахунок їх не покаже.',
};
const partial = paymentOutcome(true, deBody);
assert.strictEqual(partial.kind, 'recorded_not_in_folio',
  '201 із folioRecorded:false — не «додано», книги розійшлись');
assert.strictEqual(partial.kind === 'recorded_not_in_folio' && partial.message, deBody.message,
  'попередження сервера доходить дослівно');
assert.strictEqual(partial.kind === 'recorded_not_in_folio' && partial.reason, deBody.folioRefusal,
  'причина відмови фоліо теж доходить — без неї «чому» не вгадується');

// ── Маркер: не готівка, грошей не рухали ──────────────────────────────────
assert.strictEqual(paymentOutcome(true, { ok: true, kind: 'marker', statusChanged: false } as never).kind,
  'marker', 'картка/банк — позначка, і вона не вдає прийняті гроші');

// ── Відсутнє поле ≠ відмова фоліо ─────────────────────────────────────────
//
// Третій стан осі, і він ловить найпростішу з можливих правок — `!folioRecorded`
// замість `=== false`.
assert.strictEqual(paymentOutcome(true, { ok: true, kind: 'fin_operation' } as never).kind,
  'recorded', 'відсутній folioRecorded — це старий клієнт, а не розходження книг');

// ── І головне твердження, заради якого модуль існує ───────────────────────
//
// Судити лише за `kind`, як судив екран, — і три випадки з семи стають
// підтвердженням. Число 3 арифметично несумісне з правильним прочитанням (0).
const asScreenDid = [noTill, {}, deBody]
  .filter((b) => (b as { kind?: unknown }).kind !== 'marker').length;
assert.strictEqual(asScreenDid, 3,
  'саме стільки випадків старий екран показував як «Платіж додано!»');
const asWeDo = [
  paymentOutcome(false, noTill), paymentOutcome(false, {}), paymentOutcome(true, deBody),
].filter((o) => o.kind === 'recorded').length;
assert.strictEqual(asWeDo, 0, 'жоден із них більше не є підтвердженням');

console.log('  ok  відмова, відмова без тіла, частковий запис, маркер і повний запис розрізняються');
console.log('  ok  старий екран показував 3 з них як «Платіж додано!» — тепер 0');
console.log('payment-outcome: усі перевірки пройдено');
