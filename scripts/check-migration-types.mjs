/**
 * Міграція і схема називають ту саму колонку РІЗНИМИ типами.
 *
 *   node scripts/check-migration-types.mjs [--strict]
 *
 * ── Як знайшлося ────────────────────────────────────────────────────────────
 *
 * 19.09.2026, під час INC-053. Міграція 0423 додавала лічильник і оголосила
 * його `INTEGER`; генератор схеми виводить тип із локальної SQLite і написав у
 * `schema.sql` `BIGINT`. Обидва файли в дереві, обидва «правильні», і жоден
 * гейт про розбіжність не сказав.
 *
 * ── Чому цього не бачить `check-schema-drift` ───────────────────────────────
 *
 * Він будує ДВІ бази: «нову» зі `schema.sql` і «стару» зі `schema.sql` ПЛЮС
 * усі міграції. В обох колонка приходить зі `schema.sql`, а `ADD COLUMN IF NOT
 * EXISTS` у другій — тиха порожня операція. Тобто розбіжність типів
 * невидима для нього ЗА ПОБУДОВОЮ, і це не недогляд: він порівнює бази, а
 * різниця тут між базою і ТЕКСТОМ, який її колись доганятиме.
 *
 * А вона справжня і дорога рівно там, де дорого: `schema.sql` описує НОВОГО
 * клієнта, міграція — той, що вже живе. Прод і бета колонки не мають, тож
 * `ADD COLUMN` там спрацює по-справжньому і дасть `integer`, тоді як свіжий
 * клієнт дістане `bigint`. Дві бази, які мають бути однією, розходяться —
 * і розходяться мовчки, бо обидві працюють.
 *
 * Це той самий клас, що INC-050 (КІ42): написане існує у двох місцях, місця
 * розходяться, і ніхто не питає, чи вони ще згодні.
 *
 * ── Що стверджується ────────────────────────────────────────────────────────
 *
 * Для кожного `ALTER TABLE <t> ADD COLUMN [IF NOT EXISTS] <c> <тип>` у
 * `db/postgres/migrations/`: якщо `<t>.<c>` є в `db/postgres/schema.sql`, типи
 * мусять збігатися з точністю до синонімів Postgres (`int4`/`integer`,
 * `timestamptz`/`timestamp with time zone`, …).
 *
 * Колонка, якої в `schema.sql` немає, не звітується: її або прибрали пізнішою
 * міграцією, або `schema.sql` ще не перегенерували — це вже питання
 * `check-schema-drift`, і два гейти на одну річ дали б подвійний шум.
 */
import fs from 'node:fs';
import path from 'node:path';

const strict = process.argv.includes('--strict');

const SCHEMA = 'db/postgres/schema.sql';
const MIGRATIONS = 'db/postgres/migrations';

/** Синоніми Postgres: різні написання одного типу — не розбіжність. */
const CANON = new Map(Object.entries({
  int: 'integer', int4: 'integer', integer: 'integer',
  int8: 'bigint', bigint: 'bigint',
  int2: 'smallint', smallint: 'smallint',
  bool: 'boolean', boolean: 'boolean',
  float8: 'double precision', 'double precision': 'double precision',
  float4: 'real', real: 'real',
  timestamptz: 'timestamptz', 'timestamp with time zone': 'timestamptz',
  timestamp: 'timestamp', 'timestamp without time zone': 'timestamp',
  varchar: 'text', 'character varying': 'text', text: 'text',
  numeric: 'numeric', decimal: 'numeric',
  json: 'json', jsonb: 'jsonb', uuid: 'uuid', date: 'date',
}));

/**
 * Сам ТИП, без того, що за ним тягнеться.
 *
 * Перша редакція брала «слова після імені колонки» і вважала типом
 * `text not null default`, `text references`, `boolean default false not null`
 * — 33 хибно-червоних із 33. Гейт, який помиляється гучно, спокушає переписати
 * під нього код; лагодиться він у гейті (AGENTS §3.2.1, сьомий випадок).
 *
 * Багатослівні типи названі поіменно: інакше `double precision` обрізалося б
 * до `double`, а `timestamp with time zone` — до `timestamp`, і це була б уже
 * не косметика, а інший тип.
 */
const TYPE_RE = /^\s*(double\s+precision|timestamp\s+with\s+time\s+zone|timestamp\s+without\s+time\s+zone|time\s+with\s+time\s+zone|character\s+varying|character|[a-z_][a-z_0-9]*)\s*(\(\s*\d+(?:\s*,\s*\d+)?\s*\))?/i;

const canon = (raw) => {
  const m = TYPE_RE.exec(raw);
  if (!m) return null;
  const t = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
  return CANON.get(t) ?? t;
};

/** Мапа «таблиця.колонка → тип» зі згенерованої схеми. */
function schemaTypes(sql) {
  const types = new Map();
  for (const m of sql.matchAll(/CREATE TABLE "?([a-z_0-9]+)"?\s*\(([\s\S]*?)\n\);/gi)) {
    const table = m[1];
    for (const line of m[2].split('\n')) {
      const c = /^\s*"([a-z_0-9]+)"\s+(.+)$/.exec(line);
      if (!c) continue;
      const t = canon(c[2]);
      if (t) types.set(`${table}.${c[1]}`, t);
    }
  }
  return types;
}

/**
 * ХРАПОВИК: дві розбіжності, що вже лежать у дереві.
 *
 * Обидві одного роду — міграція каже `integer`, схема `bigint`:
 *
 *   cm_outbox.field_mask              0066
 *   fin_recurring_templates.failed_runs  0121
 *
 * Вони НЕ виправляються переписуванням тих міграцій: на беті й проді ті
 * `ALTER` уже відпрацювали, і текст у файлі нічого там не змінить. Привести
 * бази до одного типу може лише НОВА міграція `ALTER … TYPE bigint`, а це
 * рішення про живі бази — не цієї задачі (INC-051…055) і не цього гейта.
 *
 * Тому вони названі поіменно і видимі, а не сховані: нова розбіжність валить
 * збірку, виправлена вимагає прибрати рядок звідси. Список, який мовчки росте,
 * — це список, якого немає.
 */
const BASELINE = new Set([
  'cm_outbox.field_mask',
  'fin_recurring_templates.failed_runs',
]);

const problems = [];
const known = [];
let compared = 0;

if (!fs.existsSync(SCHEMA) || !fs.existsSync(MIGRATIONS)) {
  problems.push({ what: `не знайдено ${SCHEMA} або ${MIGRATIONS}` });
} else {
  const types = schemaTypes(fs.readFileSync(SCHEMA, 'utf8'));
  if (!types.size) problems.push({ what: `у ${SCHEMA} не розібрано жодної колонки — гейт нічого не стереже` });

  for (const file of fs.readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith('.sql')) continue;
    const src = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
      // Коментарі геть: міграції тут пояснюють себе довго, і приклади в
      // поясненні гейт рахував би за код (AGENTS §4).
      .replace(/--[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');

    const re = /ALTER\s+TABLE\s+(?:ONLY\s+)?"?([a-z_0-9]+)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_0-9]+)"?\s+([\s\S]{1,80}?)(?:,|;|$)/gi;
    for (const m of [...src.matchAll(re)]) {
      const key = `${m[1]}.${m[2]}`;
      const want = types.get(key);
      if (!want) continue;          // колонки в схемі немає — питання не це
      const got = canon(m[3]);
      if (!got) continue;
      compared++;
      if (got !== want) {
        if (BASELINE.has(key)) { known.push(`${key}: ${got} проти ${want} (${file})`); continue; }
        problems.push({
          what: `${file}: \`${key}\` оголошена як \`${got}\`, а в ${SCHEMA} вона \`${want}\``,
          fix:
            'схема описує НОВОГО клієнта, міграція — того, що вже живе: різні типи дають дві різні бази.\n' +
            '      `check-schema-drift` цього не бачить за побудовою — в обох його базах колонка\n' +
            '      приходить зі schema.sql, а ADD COLUMN IF NOT EXISTS там порожня операція.',
        });
      }
    }
  }
}

/** Стеля, яку забули опустити, — це стеля, якої немає. */
for (const key of BASELINE) {
  if (!known.some((k) => k.startsWith(`${key}:`))) {
    problems.push({
      what: `\`${key}\` стоїть у BASELINE, а розбіжності більше немає`,
      fix: 'приберіть рядок із BASELINE у scripts/check-migration-types.mjs — інакше стеля тримає повітря',
    });
  }
}

console.log('check-migration-types');
if (problems.length === 0) {
  console.log(`  чисто — ${compared} колонок, доданих міграціями, названі тим самим типом, що в схемі`);
  if (known.length) {
    console.log(`  відомих розбіжностей (храповик): ${known.length}`);
    for (const k of known) console.log(`    ~ ${k}`);
    console.log('    нова валить збірку; ці дві лікуються лише новою міграцією ALTER … TYPE');
  }
  process.exit(0);
}
for (const p of problems) {
  console.log(`  ✗ ${p.what}`);
  if (p.fix) console.log(`      → ${p.fix}`);
}
console.log(`\n  ${problems.length} — мігроване середовище і новий клієнт дістануть РІЗНІ типи.`);
process.exit(strict ? 1 : 0);
