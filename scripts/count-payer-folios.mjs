/**
 * Скільки в цій базі фоліо БЕЗ броні — і чи всі вони фоліо платника.
 *
 *   DATABASE_URL=postgres://… node scripts/count-payer-folios.mjs
 *
 * ── Навіщо ─────────────────────────────────────────────────────────────────
 *
 * `fin_folios.reservation_id` був нульовим у схемі задовго до 0140 — тобто
 * база дозволяла рахунок без броні ще тоді, коли код цього не вмів. 0140
 * додала `company_id` і навчила код заводити фоліо ПЛАТНИКА, і питання перед
 * продакшном одне: чи не було таких рядків РАНІШЕ. Якщо були — це не фоліо
 * платника, а щось інше під тим самим виглядом, і воно поїде в «відкриті
 * фактури фірми» з порожньою фірмою.
 *
 * Очікуване: `без броні = 0`, або ж усі вони з названою фірмою. Будь-який
 * рядок без броні І без фірми — стоп до продакшну, а не після.
 *
 * ── Чому скриптом, а не командою ───────────────────────────────────────────
 *
 * AGENTS §5: оператору не диктуються разові команди на сервер. Питання буде
 * ставитись ще раз — перед кожним переїздом клієнта, — тож воно має бути
 * командою, а не рядком у чиємусь звіті.
 *
 * Тільки читає. Жодного запису, жодного DDL.
 */
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL не заданий — вкажіть базу, яку рахуємо');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

// Колонка могла ще не приїхати: база без 0140 — це не помилка скрипта, це
// відповідь «міграції ще не накочено», і вона мусить читатись саме так.
const { rows: hasCol } = await client.query(
  `SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fin_folios' AND column_name = 'company_id'`);

const { rows } = await client.query(`
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE reservation_id IS NULL)::int AS no_reservation
    FROM fin_folios`);

console.log(`\nбаза: ${url.replace(/:[^:@/]*@/, ':***@')}`);
console.log(`  фоліо всього:            ${rows[0].total}`);
console.log(`  з них БЕЗ броні:         ${rows[0].no_reservation}`);

let orphans = 0;
if (hasCol.length) {
  const { rows: r2 } = await client.query(`
    SELECT COUNT(*)::int AS n FROM fin_folios
     WHERE reservation_id IS NULL AND company_id IS NULL`);
  orphans = r2[0].n;
  console.log(`  без броні І без фірми:   ${orphans}`);
} else {
  console.log('  без броні І без фірми:   — колонки company_id немає, 0140 не накочено');
}

await client.end();

if (orphans > 0) {
  console.log(`\n✗ ${orphans} фоліо без броні й без фірми: це НЕ фоліо платника.`);
  console.log('  У «відкритих фактурах фірми» вони не зʼявляться взагалі (фільтр по company_id),');
  console.log('  але й у списку рахунків броні їх немає. Розібрати ДО продакшну.');
  process.exit(1);
}
console.log('\n✓ жодного фоліо без броні й без фірми');
