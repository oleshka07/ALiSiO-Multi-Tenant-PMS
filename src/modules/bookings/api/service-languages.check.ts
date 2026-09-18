/**
 * Довідник послуг ПИШЕ колонки мов — усі шість, і список у нього з реєстру.
 *
 *   node src/modules/bookings/api/service-languages.check.ts
 *
 * ── Що було зламано ─────────────────────────────────────────────────────
 *
 * Колонок у `additional_services` вісімнадцять: три поля × шість мов. Писача
 * мали ТРИ — `name_en`, `name_cs`, `name_de`, перелічені руками і в `INSERT`,
 * і в списку полів `UPDATE`, і у формі. Польський, нідерландський і
 * французький гість не мав шансу побачити свою мову, скільки б її не
 * перекладали: колонка є, форма не питає, запит не пише, екран не знаходить.
 *
 * ── Чому це гейт, а не читання ──────────────────────────────────────────
 *
 * Список колонок у цьому `INSERT` ДИНАМІЧНИЙ: скільки мов заповнено, стільки
 * й слотів `?`. Помилка на одиницю там — 500 на кожне створення послуги, і не
 * бачить її ніхто: `tsc` не читає SQL (це рядок), `check-dialect` читає, але
 * не виконує. AGENTS §4 про це прямо: прогін обовʼязковий, якщо чіпали SQL.
 *
 * Писач винесено з хендлера іменованою функцією саме заради цього — тим самим
 * рухом, що в `list-export-scope.check`: `withPermission` кличе `cookies()`,
 * який поза запитом Next кидає.
 *
 * ── Осі, і чому фікстура не вироджена (інваріант 26) ────────────────────
 *
 * КІЛЬКІСТЬ ЗАПОВНЕНИХ МОВ — три різні значення: нуль, дві, всі шість. Один
 *   рядок з однаковою кількістю лишив би помилку на одиницю невидимою рівно
 *   тоді, коли слотів рівно стільки, скільки в фікстурі.
 * ПОРОЖНІЙ РЯДОК проти ВІДСУТНОСТІ — форма шле `''` за кожне поле, якого не
 *   торкались, і саме так `name_pl = ''` опинялось би в половині рядків. У
 *   базі має лишитись NULL, а не порожній рядок: порожнє в колонці читається
 *   як відповідь тим, хто не подивиться.
 * ПОЛЕ — не лише `name`: опис і одиниця мають ті самі шість колонок, і
 *   список, зібраний лише по назві, лишив би дванадцять без писача.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-svc-langs-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { CONTENT_COLUMN_LANGS } = await import('@core/i18n/content-field.ts');
const { writeNewService } = await import('./additional-services.handlers.ts');

const sql = getSql();
let ok = 0;
const say = (what: string) => { console.log(`  ok  ${what}`); ok += 1; };

await sql.run('INSERT INTO organizations (id, name, slug, default_currency, language) VALUES (?,?,?,?,?)',
  ['__svc_org', 'Org', 'svc-org', 'EUR', 'de']);
await runWithOrganization('__svc_org', () => sql.run(
  "INSERT INTO properties (id, organization_id, name, slug, country) VALUES ('__svc_prop','__svc_org','Haus','haus','DE')"));

const LANGS = [...CONTENT_COLUMN_LANGS];
assert.ok(LANGS.length >= 5, `колонок заведено під ${LANGS.length} мов — перевірка майже нічого не стереже`);

/** Прочитати рядок «згори», всі вісімнадцять колонок. */
const read = (id: string) => runWithOrganization('__svc_org', () => sql.row<Record<string, unknown>>(
  'SELECT * FROM additional_services WHERE id = ?', [id]));

// ── 1. Жодної мови ──────────────────────────────────────────────────────
await runWithOrganization('__svc_org', () => writeNewService('__svc_none', '__svc_prop', {
  name: 'Tiefgarage', price: 10, category: 'other', vat_code: 'standard',
}));
const none = await read('__svc_none');
assert.ok(none, 'послуга без жодної мови не записалась — динамічний список зламав INSERT на нулі слотів');
assert.strictEqual(none!.name, 'Tiefgarage', 'базова колонка не та');
assert.strictEqual(Number(none!.price), 10, 'ціна лягла не в ту колонку — слоти зсунуті');
assert.strictEqual(none!.currency, 'EUR', 'валюта не взялась від готелю (COALESCE у підзапиті)');
for (const code of LANGS) {
  assert.strictEqual(none![`name_${code}`] ?? null, null,
    `name_${code} записано, хоча його не передавали`);
}
say('нуль мов: рядок є, ціна й валюта на місці, колонки мов порожні');

// ── 2. Дві мови, і серед переданих є ПОРОЖНІ ────────────────────────────
//
// Саме та форма, яку шле екран: він передає ВСІ вісімнадцять ключів, і ті,
// яких не торкались, приходять порожнім рядком.
const partial: Record<string, unknown> = {
  name: 'Frühstück', price: 15, category: 'food', vat_code: 'reduced',
  description: 'Buffet', unit_label: 'pro Person',
};
for (const code of LANGS) {
  partial[`name_${code}`] = '';
  partial[`description_${code}`] = '';
  partial[`unit_label_${code}`] = '';
}
partial.name_cs = 'Snídaně';
partial.name_en = '  Breakfast  ';      // з пробілами: писач мусить обрізати
partial.unit_label_cs = 'za osobu';
await runWithOrganization('__svc_org', () => writeNewService('__svc_two', '__svc_prop', partial));
const two = await read('__svc_two');
assert.ok(two, 'послуга з двома мовами не записалась');
assert.strictEqual(two!.name, 'Frühstück');
assert.strictEqual(Number(two!.price), 15, 'ціна зсунулась — слотів і значень різна кількість');
assert.strictEqual(two!.name_cs, 'Snídaně');
assert.strictEqual(two!.name_en, 'Breakfast', 'пробіли навколо не обрізані — у колонці не те слово');
assert.strictEqual(two!.unit_label_cs, 'za osobu', 'колонки мов зібрані лише по полю `name`');
for (const code of LANGS) {
  if (code === 'cs' || code === 'en') continue;
  assert.strictEqual(two![`name_${code}`] ?? null, null,
    `name_${code} = порожній рядок замість NULL — порожнє в колонці читається як відповідь`);
}
assert.strictEqual(two!.description_cs ?? null, null, 'порожній опис записано рядком');
say('дві мови серед вісімнадцяти порожніх: записані саме вони, решта NULL, пробіли обрізані');

// ── 3. Усі шість, і всі три поля ────────────────────────────────────────
const full: Record<string, unknown> = {
  name: 'Wäscheservice', price: 5, category: 'other', vat_code: 'standard',
  description: 'Wäsche', unit_label: 'pro Stück',
};
for (const code of LANGS) {
  full[`name_${code}`] = `name-${code}`;
  full[`description_${code}`] = `desc-${code}`;
  full[`unit_label_${code}`] = `unit-${code}`;
}
await runWithOrganization('__svc_org', () => writeNewService('__svc_all', '__svc_prop', full));
const all = await read('__svc_all');
assert.ok(all, 'послуга з усіма вісімнадцятьма колонками не записалась — саме тут зсув слотів і вилазить');
assert.strictEqual(Number(all!.price), 5, 'ціна зсунулась при вісімнадцяти додаткових слотах');
assert.strictEqual(all!.name, 'Wäscheservice', 'базова назва затерта значенням мовної колонки');
for (const code of LANGS) {
  assert.strictEqual(all![`name_${code}`], `name-${code}`,
    `name_${code} містить «${all![`name_${code}`]}» — значення розʼїхались із колонками`);
  assert.strictEqual(all![`description_${code}`], `desc-${code}`, `description_${code} не те`);
  assert.strictEqual(all![`unit_label_${code}`], `unit-${code}`, `unit_label_${code} не те`);
}
say(`усі ${LANGS.length} мов × 3 поля: кожне значення у своїй колонці`);

// ── 4. Три різні кількості слотів дали три різні рядки ──────────────────
//
// Друга половина інваріанта 26: числа несумісні з альтернативним прочитанням.
// Писач, який ігнорує передані мови, дав би тут три однакові набори NULL.
const filled = (row: Record<string, unknown> | null) =>
  LANGS.filter((c) => row?.[`name_${c}`]).length;
assert.deepStrictEqual([filled(none), filled(two), filled(all)], [0, 2, LANGS.length],
  `заповнено ${filled(none)}/${filled(two)}/${filled(all)} мов, а передавали 0/2/${LANGS.length} — `
  + 'писач не читає того, що йому дали');
say('нуль, дві, шість — три різні кількості, як і передавали');

// ── 5. Список колонок писача = реєстр, а не сусідній список ─────────────
//
// Твердження про ПОВНОТУ, не про наявність: писач, у якого список свій, зійдеться
// сам із собою і лишить нові мови без колонок мовчки.
const columns = await runWithOrganization('__svc_org', () => sql.rows<Record<string, unknown>>(
  'SELECT * FROM additional_services WHERE id = ?', ['__svc_all']));
const have = Object.keys(columns[0]);
for (const field of ['name', 'description', 'unit_label']) {
  for (const code of LANGS) {
    assert.ok(have.includes(`${field}_${code}`),
      `у таблиці немає колонки ${field}_${code}, а писач її називає — свіжий клієнт дістане 500`);
  }
}
say('кожна колонка, яку називає писач, у таблиці є');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`service-languages: довідник пише всі ${LANGS.length} мов, ${ok} тверджень`);
