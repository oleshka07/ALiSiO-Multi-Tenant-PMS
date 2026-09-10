/**
 * Вимір осі обʼєкта розрізняє ТРИ речі, а не дві.
 *
 *   node scripts/lib/property-scope-scan.check.mjs
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `NAMED_IN_FILTER` знав три форми обмеження і не знав нуль-безпечної. Тому
 * фікс INC-033 — `property_id IS NOT DISTINCT FROM ?` у
 * `reports/data/partner-report.repo.ts`, тобто ПРАВИЛЬНО звужений запит по
 * NULLABLE-колонці, — діставав дві неправильні відповіді нараз: «мовчить» у
 * стелі і рядок у списку осі орендаря.
 *
 * Помилка обмежувальна, не дозвільна: дірки вона не пропускає. Але напрямок
 * поганий — сесія, яка звужує нульову колонку ПРАВИЛЬНО, кредиту не отримує, а
 * та, що перепише на `= ?` (на нульовій колонці це регресія: рядок із NULL
 * випадає), стелю опустить, і гейт її похвалить. Гейт, який винагороджує ваду
 * (AGENTS §3.2.1).
 *
 * ── І друга половина, важливіша ─────────────────────────────────────────
 *
 * `bucket()` видавав `unknown` ЛИШЕ коли в умові є підстановка. Тому форма,
 * яку видно очима, але яку список не впізнав, падала в `silent` — і ставала
 * нерозрізненною від «осі немає взагалі». Три різні стани зливались у два:
 *
 *   осі немає               → нічого не обмежує        → silent
 *   вісь ОРЕНДАРЯ           → обмежує рахунок, не дім  → silent + tenantJoinOnly
 *   форма, якої не знаємо   → щось обмежує, що саме — не знаємо → unknown
 *
 * Третій стан мусить бути окремим: «не доведено» від цього не міняється (стеля
 * рахує silent + unknown), але невпізнана форма більше не спадає САМА СОБОЮ,
 * і її видно в розбивці.
 *
 * ЧЕСНО ПРО ВИХІД: на дереві 09.09.2026 ця половина не зрушила ЖОДНОЇ пари —
 * `невизначено` як було 81, так і лишилось 81. Тобто статично видимих і
 * невпізнаних форм у коді зараз немає, і правка тут — сторож на майбутнє, а не
 * виміряне покращення. Приписати їй числа означало б рівно INC-018: гейт, що
 * «покращився» від зміни, яка нічого не полагодила.
 *
 * ── Вісь цієї сцени ─────────────────────────────────────────────────────
 *
 * Кожне твердження має ПАРУ, що відрізняється рівно тим, про що воно (§26):
 * `IS NOT DISTINCT FROM ?` проти `IS NOT DISTINCT FROM 'літерал'`;
 * `IS ?` проти `IS NOT NULL`; невпізнана форма проти відсутньої осі; вісь
 * орендаря проти невпізнаної форми. Однакового вердикту в парі немає ніде.
 */
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource, propertyScopedTables } from './property-scope-scan.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const scopedTables = propertyScopedTables(ROOT);

/** Один запит до `units` з названою умовою — рівно одна пара. */
const q = (where) => `const s = \`SELECT u.id FROM units u WHERE ${where}\`;`;

const one = (where) => {
  const hits = scanSource(q(where), 'scan-check.ts', scopedTables);
  assert.strictEqual(hits.length, 1, `очікували рівно одну пару на «${where}», отримали ${hits.length}`);
  return hits[0];
};

const says = (where, verdict, why) => {
  const hit = one(where);
  assert.strictEqual(hit.verdict, verdict,
    `«${where}» → очікували «${verdict}», отримали «${hit.verdict}» (${why})`);
  return hit;
};

// ── 1. Нуль-безпечне порівняння з ПАРАМЕТРОМ обмежує ────────────────────────
//
// Саме так пишуть звуження по NULLABLE-колонці: `= ?` там втратив би рядки з
// NULL мовчки. Три діалектні написання одного і того самого.
for (const where of [
  'u.property_id IS NOT DISTINCT FROM ?',
  'u.property_id IS DISTINCT FROM ?',
  'u.property_id IS ?',                 // SQLite пише саме так
  'u.property_id IS NOT ?',
  'u.property_id IS NOT DISTINCT FROM $1',
  'u.property_id IS NOT DISTINCT FROM :propertyId',
]) {
  says(where, 'names', 'нуль-безпечне обмеження проти параметра — це обмеження');
}
console.log('  ok  IS [NOT] DISTINCT FROM / IS [NOT] проти параметра — «names» (6 написань)');

// ── 1.1 `COALESCE(property_id, '') = ?` — третя нуль-безпечна форма ─────────
//
// Її пишуть там, де той самий вираз стоїть в УНІКАЛЬНОМУ ІНДЕКСІ
// (`idx_invoice_series_row`, `idx_invoice_counters_row`,
// `idx_channel_rate_rules_row`): запит мусить збігатися з індексом слово в
// слово, інакше він його не бере. Гейт цієї форми не знав і вимагав переписати
// правильне звуження на `= ?` — тобто винагороджував регресію (§3.2.1).
for (const where of [
  "COALESCE(property_id, '') = ?",
  "COALESCE(s.property_id, '') = ?",
  "COALESCE(property_id,'') = $1",
  "COALESCE(property_id, '') <> :propertyId",
]) {
  says(where, 'names', 'COALESCE проти параметра — це обмеження названим будинком');
}
// І друга половина пари: те саме БЕЗ параметра будинку не називає.
//
// Кошик тут `silent`, а не `unknown`, і це виміряно, а не бажано: у
// `COALESCE(property_id, '') = ''` поруч із самою колонкою стоїть кома, тож
// після вирізання відомих форм від неї не лишається «property_id поруч із
// оператором» — сканеру нема чого не зрозуміти. Порівняй із
// `IS NOT DISTINCT FROM 'prop_1'`, де колонка стоїть просто перед оператором і
// тому потрапляє в «не знаємо». Різниця в тому, що бачить ВИМІР, а не в тому,
// що ми думаємо про запит.
says("COALESCE(property_id, '') = ''", 'silent',
  'COALESCE проти літерала жодного будинку не називає');
console.log("  ok  COALESCE(property_id,'') проти параметра — «names» (4 написання), проти літерала — ні");

// ── 2. Ті самі слова БЕЗ параметра нічого не обмежують ──────────────────────
//
// Друга половина пари. `IS NOT NULL` — це «колонка заповнена», а не «цей
// будинок»; літерал — це чужий будинок, зашитий у код (інваріант 20), і
// називати його «названою віссю» означало б хвалити ваду.
says("u.property_id IS NOT DISTINCT FROM 'prop_1'", 'unknown',
  'літерал звужує до ОДНОГО будинку, зашитого в код (інваріант 20) — назвати це '
  + '«названою віссю» означало б похвалити ваду; але й «осі немає» тут неправда');
// А `IS NOT NULL` — інша річ, і тому інший кошик. Цю форму ми розуміємо
// ПОВНІСТЮ: вона каже «колонка заповнена» і не називає жодного будинку. Тобто
// обмеження на область тут справді немає — `silent`, а не «не знаємо».
says('u.property_id IS NOT NULL', 'silent', 'IS NOT NULL зрозуміле і будинку не називає');
console.log('  ok  літерал — «unknown», IS NOT NULL — «silent»: обидва не «names», але й не одне й те саме');

// ── 3. Невпізнана форма ≠ «осі немає взагалі» ───────────────────────────────
//
// Головне твердження. Обидва рядки нижче «не доведено» однаково, але
// РОЗРІЗНЯЮТЬСЯ: перший каже «щось обмежує, форми не знаю», другий — «нічого».
says('u.property_id = ANY(?)', 'unknown', 'форму видно очима, списку вона невідома');
says('u.property_id BETWEEN ? AND ?', 'unknown', 'форму видно очима, списку вона невідома');
says('u.is_active = TRUE', 'silent', 'осі немає взагалі — це інший стан');
console.log('  ok  невпізнана форма — «unknown», відсутня вісь — «silent»: три стани, не два');

// ── 4. Вісь ОРЕНДАРЯ лишається впізнаною, а не «невідомою» ──────────────────
//
// Обидві її форми інструмент знає точно — він же й позначає їх `tenantJoinOnly`.
// Зсунути їх у «невідоме» означало б втратити список, заради якого прапорець і
// заведено.
for (const [where, why] of [
  ['u.property_id IN (SELECT id FROM properties WHERE organization_id = ?)', 'підзапитом'],
  ['u.is_active = TRUE', 'без осі'],
]) {
  const hit = says(where, 'silent', `вісь орендаря ${why} — впізнана, не «невідома»`);
  if (where.includes('SELECT')) {
    assert.strictEqual(hit.tenantJoinOnly, true, 'вісь орендаря втратила свій прапорець');
    assert.strictEqual(hit.loose, 'names', 'старе означення мало називати це названим');
  } else {
    assert.strictEqual(hit.tenantJoinOnly, false, 'запит без осі позначено як вісь орендаря');
  }
}
// Та сама вісь орендаря ДЖОЙНОМ — і обома боками рівності.
//
// Це не педантизм: перша редакція цієї правки питала «чи стоїть property_id
// ліворуч від оператора», і тоді ОДИН І ТОЙ САМИЙ джойн діставав різний кошик
// залежно від того, як його набрав автор. У дереві є обидва написання —
// `x.property_id = p.id` 40 разів, `p.id = x.property_id` 70 (grep по `src/`
// на 09.09.2026), — тож вимір залежав би від смаку того, хто набирав.
// §3.2.1: візерунок треба вгадати, властивість — ні.
for (const on of ['p.id = u.property_id', 'u.property_id = p.id']) {
  const joined = scanSource(
    `const s = \`SELECT u.id FROM units u JOIN properties p ON ${on} WHERE p.organization_id = ?\`;`,
    'scan-check.ts', scopedTables);
  assert.strictEqual(joined.length, 1, `очікували одну пару на джойні «${on}»`);
  assert.strictEqual(joined[0].verdict, 'silent',
    `вісь орендаря джойном «${on}» мала лишитись «silent», а не «${joined[0].verdict}»`);
  assert.strictEqual(joined[0].tenantJoinOnly, true, `джойн «${on}» втратив прапорець осі орендаря`);
}
console.log('  ok  вісь орендаря — «silent» + tenantJoinOnly трьома написаннями (підзапит і два боки джойна)');

// ── 5. Підстановка й далі дає «unknown» ─────────────────────────────────────
//
// Правка не мала з'їсти те, заради чого третій кошик заводився.
says('${where}', 'unknown', 'умова приїздить підстановкою — так було і має лишитись');
const door = scanSource(
  "const f = propertyScopeFilter(scope, 'u');\nconst s = `SELECT u.id FROM units u WHERE ${f.sql}`;",
  'scan-check.ts', scopedTables);
assert.strictEqual(door[0]?.verdict, 'names', 'фрагмент від дверей мав лишитись «names»');
console.log('  ok  підстановка — «unknown», фрагмент від дверей — «names»');

console.log('property-scope-scan: три стани розрізняються, нуль-безпечне обмеження впізнане');
