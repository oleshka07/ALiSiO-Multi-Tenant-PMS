/**
 * Названа відмова доходить до людини; помилка драйвера — ні.
 *
 *   node src/core/http/errors.check.ts
 *
 * Рецензія 07.09 раунд 3. `serverError` закривав 500, і на цьому все
 * зупинилось: 4xx «лишає своє повідомлення» — правило правильне рівно доти,
 * доки в `catch` ловиться НАША відмова. У `finance/api/operations.handlers`
 * той самий `catch` накривав і валідатор, і запис у базу, і віддавав
 * `e.message` зі статусом 400: клієнт діставав текст CHECK зі списком
 * дозволених значень і назвою колонки, у лог не йшло нічого, а 400 виглядав
 * як «оператор помилився», а не як поломка.
 *
 * Тому рід помилки тепер названий на місці кидання (`refuse`), а `catch`
 * його розбирає (`handleError`). Тут доводиться і те, і те — на ВІДПОВІДІ,
 * не на формі виклику.
 *
 * Осі (інваріант 26): дві помилки в одному розборі — наша відмова і
 * автентичний текст драйвера («no such column: r.organization_id»); два
 * статуси (400 і 500); плюс відмова з ІНШИМ статусом (409), щоб «завжди
 * 400» не проходило.
 */
import assert from 'node:assert';
import '../../../scripts/lib/module-aliases.mjs';

const { refuse, isRefusal, handleError, Refusal } = await import('./errors.ts');

const DRIVER = 'no such column: r.organization_id';

// ── 1. Названа відмова: свій статус, свій текст ───────────────────────────
let caught: unknown;
try { refuse('amount must be a positive number'); } catch (e) { caught = e; }
assert.ok(isRefusal(caught), 'refuse() мусить кидати щось, що розпізнається як відмова');
const refused = handleError('check', caught);
assert.strictEqual(refused.status, 400, 'названа відмова — 400');
assert.strictEqual((await refused.json()).error, 'amount must be a positive number',
  'і своїм текстом: це повідомлення написали ми, і воно каже оператору, що робити');

// ── 2. Відмова з іншим статусом лишається собою ──────────────────────────
const conflict = handleError('check', new Refusal('Промокод вичерпано', 409));
assert.strictEqual(conflict.status, 409, 'статус відмови не підмінюється на 400');

// ── 3. Помилка драйвера: 500, і тексту в тілі немає ──────────────────────
//
// Найважливіше твердження файлу. Друга половина — `console.error` — тут не
// перехоплюється навмисно: вона є в `serverError` і доведена тим, що деталь
// узагалі кудись іде; предмет цього гейта — що вона НЕ йде клієнтові.
const broke = handleError('check', new Error(DRIVER));
assert.strictEqual(broke.status, 500, 'помилка драйвера — 500, а не 400: поломка мусить виглядати поломкою');
const body = await broke.json();
assert.ok(!String(body.error).includes(DRIVER),
  `текст драйвера не має доходити клієнтові, а прийшло: ${body.error}`);
assert.ok(!String(body.error).includes('organization_id'), 'і назв колонок теж');
assert.ok(String(body.error).length > 0, 'але речення бути мусить — порожня відповідь нікому не допомагає');

// ── 4. Не-Error теж не тече ───────────────────────────────────────────────
const weird = handleError('check', { message: DRIVER });
assert.strictEqual(weird.status, 500);
assert.ok(!String((await weird.json()).error).includes(DRIVER), 'обʼєкт із полем message — не відмова');

console.log('errors: названа відмова доходить своїм статусом і текстом; помилка драйвера — 500 без жодного слова з неї');
