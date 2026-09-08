/**
 * Гейт на сам гейт: `check-error-leak` бачить те, що має, і не бачить решти.
 *
 *   node scripts/check-error-leak.check.mjs
 *
 * Рецензія раунду 8, Р8.4. У гейта не було свого гейта, і це не формальність:
 * за дві доби він тричі мовчав там, де мав говорити, і щоразу з ТЕХНІЧНОЇ
 * причини, невидимої з коду —
 *
 *   П4 (раунд 7)   `try` шукалось ПІДРЯДКОМ, тож слово `country` у тілі
 *                  вважалося початком блока, і зовнішній обробник судився за
 *                  обрізаним шматком;
 *   Р8.1 (раунд 8) пара «try — catch» бралась як «найближче `try` ліворуч»,
 *                  тож на вкладеності зовнішній `catch` судився за тілом
 *                  ВНУТРІШНЬОГО;
 *   Р8.1 (там же)  шукався ЛІТЕРАЛЬНИЙ `status: 4xx`, а обробники, які
 *                  віддають статус із помилки, пишуть його обчисленим.
 *
 * Тому тут не «чи запускається», а перелік випадків, кожен зі своїм родом
 * мовчання. Фікстури — рядки, не файли: вони видимі просто в тексті
 * твердження, і жодного тимчасового каталогу прибирати не треба.
 *
 * Осі (інваріант 26). Для кожної здатності є пара «мусить побачити» /
 * «мусить пропустити», інакше «завжди червоне» і «завжди зелене» дали б
 * однакову відповідь:
 *
 *   рід try      вкладений проти простого
 *   слово try    справжній `try {` проти `country` у тілі
 *   статус       обчислений, літеральна 4xx, літеральна 5xx, рядковий
 *   чекання      `await` у тілі проти цілком синхронного валідатора
 *   відповідь    `NextResponse.json` проти звичайного обʼєкта звіту
 *
 * ── Чим доведена червоність, поіменно ───────────────────────────────────
 *
 * Не «гейт запускається», а три мутації, кожна — відтворення того, як гейт
 * мовчав насправді:
 *
 *   `tryBody` від `lastIndexOf('try', end)`   → червоніє твердження 1
 *      (старе спарювання до раунду 8; на ньому «country» і різало тіло)
 *   `statusKind` повертає лише літерал         → червоніє твердження 3
 *   зняти вимогу `NextResponse.json`           → червоніє твердження 4(б)
 *
 * І чесно про те, чого тут НЕ доведено: прибирання `\b` з `\btry\s*\{`
 * лишає гейт зеленим, і це не діра в твердженні, а властивість нинішнього
 * пристрою — пошук іде ВПЕРЕД по `try {`, а поєднання «country {» у коді не
 * трапляється. Стара вада була можлива саме тому, що пошук ішов НАЗАД. Тобто
 * твердження 1 стереже не межу слова, а напрямок пошуку.
 */
import assert from 'node:assert';
import { analyse } from './check-error-leak.mjs';

const blindCount = (src) => analyse(src).blind.length;
const leakCount = (src) => analyse(src).offenders.length;

// ── 1. П4: слово `country` у тілі — не початок блока ──────────────────────
//
// Старий пошук брав `lastIndexOf('try')`, натикався на «coun-TRY» і різав
// тіло по ньому: те, що лишалося, виглядало синхронним, і гейт мовчав. Тут
// `await` стоїть ВИЩЕ за `country` навмисно — саме він і губився.
assert.strictEqual(blindCount(`
export async function POST(req) {
  try {
    const row = await sql.row('SELECT country FROM properties WHERE id = ?', [id]);
    const country = row?.country ?? null;
    return NextResponse.json({ country });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
`), 1, 'слово «country» у тілі не має обрізати блок try — це підрядок, а не ключове слово');

// ── 2. Р8.1: вкладений try ────────────────────────────────────────────────
//
// Внутрішній блок СИНХРОННИЙ навмисно: на ньому старий пошук і давав зелене.
assert.strictEqual(blindCount(`
export async function POST(req) {
  try {
    const raw = await req.text();
    await sql.run('UPDATE t SET a = ?', [1]);
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    return NextResponse.json({ parsed });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
`), 1, 'зовнішній catch судиться за СВОЇМ тілом, а не за тілом внутрішнього try');

// ── 3. Р8.1: обчислений статус ────────────────────────────────────────────
assert.strictEqual(blindCount(`
try {
  const id = await requirePropertyId(body.property_id);
  return NextResponse.json({ id });
} catch (e) {
  return NextResponse.json({ error: e.message }, { status: propertyErrorStatus(e) });
}
`), 1, 'статус, обчислений із помилки, — саме те, як пишуть обробники, що хочуть її переказати');

assert.strictEqual(blindCount(`
try {
  await sql.run('UPDATE t SET a = ?', [1]);
  return NextResponse.json({ ok: true });
} catch (e) {
  return NextResponse.json({ error: e.message }, { status });
}
`), 1, 'скорочене `{ status }` — теж обчислений статус');

// ── 4. Що гейт мусить ПРОПУСТИТИ ──────────────────────────────────────────
//
// Без цих чотирьох «завжди червоний» був би невідрізненний від правильного.

// (а) синхронний валідатор: чекати нема на що, ловиться лише власний текст
assert.strictEqual(blindCount(`
try {
  if (!Number.isFinite(amount)) throw new Error('amount must be a positive number');
  return NextResponse.json({ ok: true });
} catch (e) {
  return NextResponse.json({ error: e.message }, { status: 400 });
}
`), 0, 'вузький catch навколо синхронного валідатора лишається дозволеним');

// (б) звіт синка: `status: 'error'` — поле журналу, не HTTP-статус
assert.strictEqual(blindCount(`
try {
  await syncChannel(id);
  return { channel_id: id, status: 'ok' };
} catch (e) {
  return { channel_id: id, status: 'error', error: e.message };
}
`), 0, 'рядковий status у звичайному обʼєкті — не відповідь клієнтові (ical-sync)');

// (в) 5xx ловить ПЕРША вісь, друга його не дублює
const fivehundred = `
try {
  await sql.run('UPDATE t SET a = ?', [1]);
  return NextResponse.json({ ok: true });
} catch (e) {
  return NextResponse.json({ error: e.message }, { status: 500 });
}
`;
assert.strictEqual(blindCount(fivehundred), 0, 'друга вісь не дублює 5xx');
assert.strictEqual(leakCount(fivehundred), 1, 'але перша вісь його бачить');

// (г) `handleError` — правильний код: тексту винятку в тілі немає
assert.strictEqual(blindCount(`
try {
  const id = await requirePropertyId(body.property_id);
  return NextResponse.json({ id });
} catch (e) {
  return handleError('booking-sites POST', e);
}
`), 0, 'правильний обробник не має бути червоним — інакше гейт заважає його ставити');

// ── 5. Кілька пар в одному файлі рахуються окремо ─────────────────────────
//
// Файли з двома обробниками — звичайна річ, і гейт мусить назвати обидва, а
// не перший. Рядки різні, тож «знайшов один і зупинився» тут видно.
assert.strictEqual(blindCount(`
try { await a(); } catch (e) { return NextResponse.json({ error: e.message }, { status: 400 }); }
try { await b(); } catch (e) { return NextResponse.json({ error: e.message }, { status: 409 }); }
`), 2, 'дві пари — дві знахідки');

console.log('check-error-leak: гейт бачить вкладений try, обчислений статус і «country» у тілі — і мовчить там, де має');
