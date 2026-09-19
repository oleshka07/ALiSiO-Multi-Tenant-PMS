/**
 * Колонка, яку знає схема і не знає писач.
 *
 *   node scripts/check-table-writers.mjs [--strict]
 *
 * ── Що сталося ──────────────────────────────────────────────────────────────
 *
 * `scripts/apply-hotel.mjs` заводить готель із файла, і зміст гостьової
 * сторінки він пише за СТАТИЧНИМ списком `COLS`. Таблиця з часом росла, список
 * — ні. Наслідок мовчазний за побудовою: поле, якого немає в списку,
 * пропускається без жодної помилки, скрипт друкує «поклав» і перелічує лише
 * те, що поклав, а `check-hotels` лишається зеленим.
 *
 * Доведено ТРИЧІ, востаннє на живій базі бети після справжнього деплою
 * 19.09.2026:
 *
 *   select left(parking_info,60), parking_maps_url from property_guest_config;
 *    Tiefgarage „Schlossgarage“ — direkt unter dem Hotel… |  (порожньо)
 *
 * `parking_info` доїхав, `parking_maps_url` — ні, хоча у файлі готелю він
 * заповнений. Кнопка «відкрити карту паркування» не вмикається взагалі.
 *
 * ── Чому РІВНІСТЬ, а не входження ───────────────────────────────────────────
 *
 * «Кожна колонка списку є в схемі» — це перевірка на друкарську помилку, і
 * вона була б зеленою весь час, поки список відстає. Дефект тут завжди в
 * протилежний бік: схема попереду. Тому твердження — РІВНІСТЬ множин, а
 * виняток (`id`, `property_id`, `created_at`, `updated_at`) названий поіменно
 * в реєстрі нижче: колонка, якої писач НЕ МАЄ чіпати, мусить бути названа
 * вголос, а не просто відсутня.
 *
 * Перший же прогін із рівністю знайшов ШОСТУ колонку, якої не було в задачі:
 * `reception_hours` (0422) — вона друкується на аркуші А4 в номері
 * (`a4-sheet.ts:316`). Список у задачі складала людина, читаючи код; рівність
 * читає схему.
 *
 * ── Що стверджується ────────────────────────────────────────────────────────
 *
 * Для кожної таблиці реєстру: множина її колонок у `db/postgres/schema.sql`,
 * мінус названі винятки, дорівнює множині колонок, яку перелічує КОЖЕН із її
 * писачів. Писачі бувають двох родів, і обидва тут є:
 *
 *   list   — масив рядків у коді (`COLS`, `fields`);
 *   insert — перелік колонок у самому `INSERT INTO <таблиця> (…)`.
 *
 * Два роди не для повноти: у `property-guest-config.handlers.ts` їх ДВА в
 * одному файлі — масив для UPDATE і перелік для INSERT, — і розійтись вони
 * можуть незалежно. Тоді правка наявного рядка писала б колонку, а створення
 * першого — ні (або навпаки), і різниця була б видна лише тому готелю, який
 * зайшов не з того боку.
 *
 * Клас — «написане не доїхало до працюючої системи» (INC-050, КІ42): поле є в
 * схемі, є на екрані, є у файлі готелю — і мовчки не доїжджає.
 */
import fs from 'node:fs';

const strict = process.argv.includes('--strict');

/**
 * Схема — канонічна, але гейт можна НАВЕСТИ на копію: `--schema <шлях>`.
 *
 * Не зручність. `db/postgres/schema.sql` генерується, і `.claude/hooks/guard.sh`
 * правильно забороняє писати в нього руками — тобто довести червоність цього
 * гейта з боку СХЕМИ (колонку додали, писача не оновили) інакше неможливо, а
 * гейт, чию червоність не можна показати, нічого не тримає (AGENTS §3.2).
 * Підбирати команди так, щоб проскочити повз хук, — гірше: після цього хук
 * лишається, а віра в нього ні. Тому шлях називається явно, а `npm run check`
 * прапорця не передає і читає канонічний файл.
 */
const schemaFlag = process.argv.indexOf('--schema');
const SCHEMA = schemaFlag !== -1 ? process.argv[schemaFlag + 1] : 'db/postgres/schema.sql';

/**
 * Реєстр. Додати таблицю — це рядок тут, а не новий гейт.
 *
 * `exempt` — колонки, які писач НЕ називає навмисно: ключ, звʼязок і час.
 * Вони перелічені, а не вгадані за іменем: колонка `*_at`, яку насправді
 * заповнює людина, інакше мовчки випала б з-під твердження.
 */
const REGISTRY = [
  {
    table: 'property_guest_config',
    exempt: ['id', 'property_id', 'created_at', 'updated_at'],
    writers: [
      { file: 'scripts/apply-hotel.mjs', kind: 'list', name: 'COLS' },
      { file: 'src/modules/properties/api/property-guest-config.handlers.ts', kind: 'list', name: 'fields' },
      { file: 'src/modules/properties/api/property-guest-config.handlers.ts', kind: 'insert' },
    ],
  },
];

/** Колонки таблиці зі згенерованої схеми. */
function schemaColumns(sql, table) {
  const re = new RegExp(`CREATE TABLE "?${table}"?\\s*\\(([\\s\\S]*?)\\n\\);`, 'i');
  const m = re.exec(sql);
  if (!m) return null;
  const cols = [];
  for (const line of m[1].split('\n')) {
    const c = /^\s*"([a-z_0-9]+)"\s+/i.exec(line);
    // PRIMARY KEY / UNIQUE / FOREIGN KEY ідуть без лапок на початку рядка.
    if (c) cols.push(c[1]);
  }
  return cols;
}

/**
 * Масив рядкових літералів, присвоєний імені: `const COLS = ['a', 'b', …];`
 * Розбір за балансом дужок, бо масив багаторядковий, а всередині є коментарі.
 */
function writerList(src, name) {
  const at = src.search(new RegExp(`\\b${name}\\s*(?::[^=]*)?=\\s*\\[`));
  if (at === -1) return null;
  const open = src.indexOf('[', at);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  const body = stripComments(src.slice(open + 1, end));
  return [...body.matchAll(/['"`]([a-z_0-9]+)['"`]/gi)].map((m) => m[1]);
}

/** Перелік колонок у `INSERT INTO <table> ( … )`. */
function writerInsert(src, table) {
  const re = new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(`, 'i');
  const m = re.exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  return src.slice(open + 1, end).split(',').map((s) => s.trim()).filter((s) => /^[a-z_0-9]+$/i.test(s));
}

/** Коментарі геть — інакше гейт рахує приклади у власній документації. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const problems = [];
let checkedWriters = 0;

if (!fs.existsSync(SCHEMA)) {
  problems.push({ what: `не знайдено ${SCHEMA}` });
} else {
  const sql = fs.readFileSync(SCHEMA, 'utf8');

  for (const entry of REGISTRY) {
    const all = schemaColumns(sql, entry.table);
    if (!all) {
      problems.push({ what: `таблиці \`${entry.table}\` немає в ${SCHEMA} — гейт не знає, з чим звіряти` });
      continue;
    }

    // Виняток, якого в таблиці вже немає, — теж розбіжність: реєстр застряг.
    for (const ex of entry.exempt) {
      if (!all.includes(ex)) {
        problems.push({
          what: `\`${entry.table}\`: виняток \`${ex}\` названий у реєстрі, а такої колонки в схемі немає`,
          fix: 'приберіть його з exempt — інакше реєстр описує таблицю, якої вже немає',
        });
      }
    }

    const want = all.filter((c) => !entry.exempt.includes(c));

    for (const w of entry.writers) {
      if (!fs.existsSync(w.file)) {
        problems.push({ what: `писач ${w.file} не знайдений` });
        continue;
      }
      const src = fs.readFileSync(w.file, 'utf8');
      const got = w.kind === 'insert' ? writerInsert(src, entry.table) : writerList(src, w.name);
      const label = `${w.file} → ${w.kind === 'insert' ? `INSERT INTO ${entry.table}` : w.name}`;

      if (!got) {
        problems.push({
          what: `${label}: не знайдено переліку колонок`,
          fix: 'гейт, який нічого не розібрав, нічого й не стереже — перевірте імʼя або форму',
        });
        continue;
      }
      checkedWriters++;

      // INSERT законно називає звʼязок (`property_id`) — він не «зміст», але
      // без нього рядка не буде. Тому для insert винятки лише віднімаються.
      const gotSet = new Set(got.filter((c) => !entry.exempt.includes(c)));

      const missing = want.filter((c) => !gotSet.has(c));
      const extra = [...gotSet].filter((c) => !want.includes(c));

      if (missing.length) {
        problems.push({
          what: `${label}: не називає ${missing.length} колонк(и) таблиці \`${entry.table}\`:\n      ${missing.join(', ')}`,
          fix: 'поле, якого писач не називає, мовчки не доїжджає: помилки немає, у звіті його просто немає',
        });
      }
      if (extra.length) {
        problems.push({
          what: `${label}: називає те, чого в \`${entry.table}\` немає: ${extra.join(', ')}`,
          fix: 'колонку перейменували або прибрали зі схеми — писач пише в нікуди',
        });
      }
    }
  }
}

console.log('check-table-writers');
if (problems.length === 0) {
  console.log(`  чисто — ${REGISTRY.length} таблиц(і), ${checkedWriters} писач(ів); кожен називає всі колонки своєї таблиці`);
  process.exit(0);
}
for (const p of problems) {
  console.log(`  ✗ ${p.what}`);
  if (p.fix) console.log(`      → ${p.fix}`);
}
console.log(`\n  ${problems.length} — писач і схема розійшлися.`);
console.log('  Колонка, якої писач не називає, не доїжджає МОВЧКИ: ні помилки, ні рядка у звіті.');
process.exit(strict ? 1 : 0);
