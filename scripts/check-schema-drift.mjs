/**
 * Чи описує schema.sql ту саму базу, яку дають міграції.
 *
 *   PGHOST=127.0.0.1 PGUSER=alisio node scripts/check-schema-drift.mjs
 *
 * Дві бази, один Postgres:
 *
 *   НОВА    тільки db/postgres/schema.sql — те, що дістає новий клієнт
 *   СТАРА   schema.sql, а зверху всі db/postgres/migrations/*.sql — те, що
 *           має середовище, яке живе давно
 *
 * Потім вони порівнюються по колонках, типах, обовʼязковості й індексах.
 * Мають збігтися до рядка. Розбіжність означає одне з двох, і обидва погані:
 * або міграція додала щось, чого немає в schema.sql (новий клієнт заводиться
 * без цього), або schema.sql має щось, чого міграція не приносить (старе
 * середовище лишається без цього назавжди).
 *
 * Навіщо це саме зараз. `schema.sql` досі ГЕНЕРУЄТЬСЯ з живої бази SQLite
 * (scripts/pg-schema.mjs), тобто джерелом істини для схеми прода є база, якої
 * на проді немає. Поки так, «схема правильна» означає «хтось не забув
 * перегенерувати». Ця перевірка ставить питання по-інакшому — до самого
 * Postgres — і саме вона має тримати схему, коли SQLite піде.
 *
 * Бета показала, у що це коштує, коли не питати: вона піднялася з 92 таблиць
 * проти 102, і жодна перевірка про це не сказала.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOST = process.env.PGHOST || '127.0.0.1';
const PORT = process.env.PGPORT || '5432';
const USER = process.env.PGUSER || 'alisio';

const psql = (db, args) => execFileSync('psql', [
  '-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-tA', ...args,
], { encoding: 'utf8', env: { ...process.env, PGCLIENTENCODING: 'UTF8' } });

const admin = (sql) => psql('postgres', ['-c', sql]);

/** Кожну базу описуємо однаково, щоб різниця була різницею, а не форматуванням. */
const DESCRIBE = `
SELECT 'column|'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable
       ||'|'||COALESCE(column_default, '-')
  FROM information_schema.columns WHERE table_schema='public'
UNION ALL
SELECT 'index|'||tablename||'|'||indexname||'|'||regexp_replace(indexdef, '.*USING ', '')
  FROM pg_indexes WHERE schemaname='public'
UNION ALL
SELECT 'table|'||table_name FROM information_schema.tables WHERE table_schema='public'
UNION ALL
-- Обмеження порівнюються теж, і не для повноти.
--
-- Перша ж колонка, додана після появи цієї перевірки, дала ДВА однакові CHECK
-- на новій базі: у schema.sql він був безіменний, тож Postgres назвав його
-- сам, а міграція не впізнала свого імені й додала другий. Функціонально це
-- нешкідливо і саме тому лишилось би назавжди — поки хтось не прибрав би
-- один, вирішивши, що правило зникло.
SELECT 'constraint|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE connamespace = 'public'::regnamespace AND contype IN ('c','u','f')
ORDER BY 1
`;

function build(db, withMigrations) {
  admin(`DROP DATABASE IF EXISTS ${db}`);
  admin(`CREATE DATABASE ${db}`);
  psql(db, ['-q', '-f', 'db/postgres/schema.sql']);
  if (withMigrations) {
    const dir = 'db/postgres/migrations';
    for (const m of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      psql(db, ['-q', '-f', path.join(dir, m)]);
    }
  }
  return psql(db, ['-c', DESCRIBE]).split('\n').filter(Boolean);
}

let fresh;
let migrated;
try {
  fresh = build('drift_fresh', false);
  migrated = build('drift_migrated', true);
} catch (e) {
  console.error('не вдалося зібрати бази для порівняння:');
  console.error(String(e.stderr || e.message).split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

const onlyIn = (a, b) => a.filter((line) => !b.includes(line));
const missingFromSchema = onlyIn(migrated, fresh);   // міграція дала, schema.sql — ні
const missingFromMigrations = onlyIn(fresh, migrated); // schema.sql має, міграція не принесе

console.log('═'.repeat(78));
console.log('SCHEMA.SQL І МІГРАЦІЇ РОЗІЙШЛИСЯ — має бути нуль');
console.log('═'.repeat(78));
console.log();

if (!missingFromSchema.length && !missingFromMigrations.length) {
  console.log(`  збігаються — ${fresh.filter((l) => l.startsWith('table|')).length} таблиць,`,
    `${fresh.filter((l) => l.startsWith('column|')).length} колонок,`,
    `${fresh.filter((l) => l.startsWith('index|')).length} індексів,`,
    `${fresh.filter((l) => l.startsWith('constraint|')).length} обмежень`);
  process.exit(0);
}

if (missingFromSchema.length) {
  console.log('  Міграція це створює, а schema.sql — ні.');
  console.log('  Новий клієнт заведеться БЕЗ цього:');
  for (const l of missingFromSchema.slice(0, 40)) console.log(`    ${l}`);
  if (missingFromSchema.length > 40) console.log(`    … ще ${missingFromSchema.length - 40}`);
  console.log();
}
if (missingFromMigrations.length) {
  console.log('  schema.sql це має, а міграції не приносять.');
  console.log('  Середовище, яке живе давно, лишиться БЕЗ цього:');
  for (const l of missingFromMigrations.slice(0, 40)) console.log(`    ${l}`);
  if (missingFromMigrations.length > 40) console.log(`    … ще ${missingFromMigrations.length - 40}`);
  console.log();
}

console.log(`  разом розбіжностей: ${missingFromSchema.length + missingFromMigrations.length}`);
process.exit(1);
