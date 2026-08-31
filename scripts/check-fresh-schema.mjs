/**
 * Does a NEW customer get the same schema as this database?
 *
 *   npm run build:win && node scripts/check-fresh-schema.mjs
 *
 * Boots the built server against an empty data directory, waits for it to
 * finish migrating, and diffs the resulting schema against data/alisio.db.
 * Tables, the columns of every shared table, and INDEXES.
 *
 * Індекси додано 31.08.2026, і не з міркувань повноти. Порівняння таблиць і
 * колонок пропускає цілий клас: `CREATE UNIQUE INDEX` окремим рядком — це
 * ОБМЕЖЕННЯ, а не пришвидшення. `idx_reservations_guest_token` не дає двом
 * гостям отримати одне посилання; `idx_price_calendar_row` не дає двом цінам
 * стати на одну добу. Відсутній на свіжій базі такий індекс не ламає нічого
 * видимого — він просто перестає забороняти, і перевірка, яка мала б це
 * спіймати, зеленіє, бо йде іншим шляхом. Той самий візерунок, що з RLS на
 * SQLite: захист є на одному двигуні й відсутній на тому, де ганяються
 * перевірки.
 *
 * Знайдено двічі за одну сесію: перебудова `reservations` у SQLite мовчки
 * знесла всі 11 індексів разом із тим унікальним (спіймав `pg-schema.mjs`,
 * не тест), а три `idx_accruals_*` виявились лише на міграційній гілці.
 *
 * Why this exists: migrations here are written as "upgrade from the previous
 * state" — `if (!cols.includes(x)) ALTER TABLE ADD COLUMN x`. Remove the
 * ALTER and an upgraded database keeps the column while a fresh one never
 * gets it; add a DROP at the end and the two disagree the other way. Nothing
 * noticed, because everyone develops against a database that has been
 * migrating for months. The first person to notice would have been customer
 * number two, on their first day.
 *
 * Reads only. The temporary database lives in the system temp directory and
 * the real one is never opened for writing.
 *
 * ── Другий режим: `--settles` ───────────────────────────────────────────
 *
 * Питання інше й перевіряється без «старої» бази взагалі: **чи припиняє
 * схема змінюватись?** Застосунок піднімається двічі на ТІЙ САМІЙ порожній
 * теці, і два знімки звіряються між собою.
 *
 * Мігратор, який на другому проході дає інше, ніж на першому, — це не
 * дрібниця: він означає, що новий клієнт і клієнт із учорашньою базою мають
 * різні схеми, і котра з них правильна, залежить від того, скільки разів
 * контейнер перезапускали. Саме так три індекси `accruals` існували лише в
 * тих, хто вже перезавантажувався: перебудова таблиці зносила їх на першому
 * проході, а `CREATE INDEX IF NOT EXISTS` повертав на другому.
 *
 * Цей режим бігає в CI: справжньої бази там немає, а порожня тека є завжди.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import Database from 'better-sqlite3';

const REAL_DB = process.env.DB_PATH || 'data/alisio.db';
const PORT = process.env.FRESH_PORT || '3999';
const TIMEOUT_MS = 120_000;
/** `--settles`: два проходи на одній порожній теці замість звірки з робочою базою. */
const SETTLES = process.argv.includes('--settles');

if (!SETTLES && !fs.existsSync(REAL_DB)) {
  console.error(`Немає ${REAL_DB} — нема з чим порівнювати.`);
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-fresh-'));
const freshDb = path.join(tmp, 'alisio.db');

console.log(SETTLES ? 'Піднімаю застосунок двічі на одній порожній базі…' : 'Піднімаю застосунок на порожній базі…');
/**
 * Один прохід: підняти застосунок на теці `tmp`, дочекатись міграцій, спинити.
 *
 * Функція, а не один запуск нагорі, бо режим `--settles` викликає її двічі на
 * тій самій теці. Журнал у кожного проходу свій: маркер завершення міграцій
 * шукається саме в ЦЬОМУ запуску, інакше другий прохід «дочекався» б рядка,
 * який надрукував перший.
 */
async function boot() {
  // `next start`, not .next/standalone/server.js: under standalone the
  // migrations stopped a few statements in and the completion marker never
  // arrived, which is a separate question from the one this script asks.
  const server = spawn('npx', ['next', 'start', '-p', PORT], {
    env: { ...process.env, ALISIO_DATA_DIR: tmp },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    // Своя група процесів: `npx` — не сервер, а його батько, і вбивство лише
    // батька лишало онука тримати порт. Один прохід цього не помічав (скрипт
    // на тому й закінчувався), а другий падав на EADDRINUSE.
    detached: process.platform !== 'win32',
  });

  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  // shell:true means server.pid is the cmd wrapper; kill() reaped the shell and
  // left the actual node process holding the port for every later run.
  const stop = () => {
    try {
      if (process.platform === 'win32') execSync(`taskkill /T /F /PID ${server.pid}`, { stdio: 'ignore' });
      else process.kill(-server.pid, 'SIGKILL');   // мінус — уся група
    } catch {
      try { server.kill('SIGKILL'); } catch { /* already gone */ }
    }
  };

  /** The app builds its schema lazily, on the first request that touches the db. */
  const deadline = Date.now() + TIMEOUT_MS;
  let poked = false;
  let ok = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    if (!poked) {
      // A POST to login, not GET /api/auth/me: without a session cookie the
      // latter answers 401 without ever opening the database, so the schema
      // was never built and this script waited out its timeout.
      try {
        await fetch(`http://localhost:${PORT}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'schema-probe@example.invalid', password: 'x' }),
        });
        poked = true;
      } catch { continue; }
    }
    if (!fs.existsSync(freshDb)) continue;
    // runMigrations prints this as its last statement. Polling the table count
    // instead reported "settled" while columns were still being added.
    if (log.includes('[DB] migrations complete')) {
      await new Promise((r) => setTimeout(r, 1500));
      ok = true;
      break;
    }
  }

  stop();
  if (!ok) {
    console.error('База не піднялася за відведений час.');
    console.error(log.split('\n').slice(-15).join('\n'));
    process.exit(2);
  }
  // Порт звільняється не миттєво, а наступний прохід сідає на той самий.
  // Чекаємо на факт, а не на секунди: фіксована пауза або марно довга, або
  // недостатня — і недостатня вона саме на повільній машині CI.
  await waitForPortFree();
}

/** Доки хтось відповідає на PORT, наступний прохід підняти не можна. */
async function waitForPortFree() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const busy = await new Promise((resolve) => {
      const probe = net.connect({ host: '127.0.0.1', port: Number(PORT) });
      probe.on('connect', () => { probe.destroy(); resolve(true); });
      probe.on('error', () => resolve(false));
    });
    if (!busy) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  console.error(`Порт ${PORT} лишився зайнятим — попередній прохід не спинився.`);
  process.exit(2);
}

await boot();

/**
 * The fresh database is opened read-WRITE on purpose: killing the server
 * leaves a hot WAL, and SQLite can only replay it with write access. The real
 * database is passed readonly by the caller below.
 */
const shape = (file, readonly = true) => {
  const d = new Database(file, { readonly });
  const tables = d.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map((r) => r.name);
  const columns = new Map(
    tables.map((t) => [t, d.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().map((c) => c.name).sort()]),
  );
  // Індекси беруться разом із їхнім `sql`, а не самими іменами: індекс із тим
  // самим іменем, але по інших колонках чи без UNIQUE, — це та сама діра з
  // виглядом цілого.
  //
  // `sql IS NULL` пропускаємо: це індекси, які SQLite створює сам під UNIQUE
  // усередині CREATE TABLE. Вони вже покриті порівнянням таблиць, а імена в
  // них службові (`sqlite_autoindex_…`) і ні про що не кажуть.
  const indexes = new Map(
    d.prepare(
      "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name",
    ).all().map((r) => [r.name, { table: r.tbl_name, sql: normalizeSql(r.sql) }]),
  );
  d.close();
  return { tables, columns, indexes };
};

/** Пробіли, лапки й регістр різняться між шляхами створення; сенс — ні. */
function normalizeSql(sql) {
  return sql.replace(/["`\[\]]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

await new Promise((r) => setTimeout(r, 800));
const fresh = shape(freshDb, false);

// У режимі `--settles` другий бік порівняння — це той самий застосунок на тій
// самій базі, піднятий ще раз. Знімок береться ДО другого проходу, бо саме
// перший прохід і є підозрюваним: мігратор, який зносить індекс і повертає
// його наступного разу, дає новому клієнту базу, слабшу за ту, яку отримає
// той самий клієнт після першого ж перезапуску контейнера.
let real;
if (SETTLES) {
  const firstPass = fresh;
  await boot();
  await new Promise((r) => setTimeout(r, 800));
  const secondPass = shape(freshDb, false);
  // Іменування навмисне: «ця» = після другого проходу, «свіжа» = після
  // першого. Тоді скарги читаються так само, як у звичайному режимі.
  real = secondPass;
  void firstPass;
} else {
  real = shape(REAL_DB);
}
// Windows keeps a handle on the file for a moment after the writer dies, so
// a failed cleanup must not fail the check — the OS clears its temp anyway.
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
catch { /* left behind in the system temp directory */ }

// Як називати два боки порівняння в скаргах. Оголошено тут, а не біля
// виводу: перший цикл нижче вже ними користується.
const LEFT = SETTLES ? 'прохід 1' : 'свіжа';
const RIGHT = SETTLES ? 'прохід 2' : 'ця';

const problems = [];
const freshSet = new Set(fresh.tables);
const realSet = new Set(real.tables);

for (const t of real.tables) {
  if (!freshSet.has(t)) problems.push(`таблиця ${t}: є у ${RIGHT}, нема у ${LEFT}`);
}
for (const t of fresh.tables) {
  if (!realSet.has(t)) problems.push(`таблиця ${t}: є у ${LEFT}, нема у ${RIGHT}`);
}
for (const t of real.tables) {
  if (!freshSet.has(t)) continue;
  const a = new Set(real.columns.get(t));
  const b = new Set(fresh.columns.get(t));
  const onlyReal = [...a].filter((c) => !b.has(c));
  const onlyFresh = [...b].filter((c) => !a.has(c));
  if (onlyReal.length) problems.push(`${t}: колонки є у ${RIGHT}, нема у ${LEFT} — ${onlyReal.join(', ')}`);
  if (onlyFresh.length) problems.push(`${t}: колонки є у ${LEFT}, нема у ${RIGHT} — ${onlyFresh.join(', ')}`);
}

// ── Індекси ────────────────────────────────────────────────────────────────
//
// Порядок скарг такий самий, як у колонок, але вага різна. Індекс, якого нема
// у НОВОГО клієнта, — це обмеження, яке в нього не діє: база виглядає робочою
// рівно доти, доки хтось не запише те, що мало б бути заборонене.
for (const [name, mine] of real.indexes) {
  const f = fresh.indexes.get(name);
  if (!f) {
    problems.push(`індекс ${name} (${mine.table}): є у ${RIGHT}, НЕМА у ${LEFT}`);
    continue;
  }
  if (f.sql !== mine.sql) {
    problems.push(`індекс ${name} (${mine.table}): різні означення`
      + `\n      ${RIGHT}: ${mine.sql}\n      ${LEFT}: ${f.sql}`);
  }
}
for (const [name, f] of fresh.indexes) {
  if (!real.indexes.has(name)) problems.push(`індекс ${name} (${f.table}): є у ${LEFT}, нема у ${RIGHT}`);
}

console.log('═'.repeat(78));
console.log(SETTLES ? 'СХЕМА ПІСЛЯ ПЕРШОГО ПРОХОДУ vs ПІСЛЯ ДРУГОГО' : 'СХЕМА НОВОГО КЛІЄНТА vs ЦІЄЇ БАЗИ');
console.log('═'.repeat(78));
console.log();
console.log(`  ${LEFT}: ${fresh.tables.length} таблиць, ${fresh.indexes.size} індексів`
  + `    ${RIGHT}: ${real.tables.length} таблиць, ${real.indexes.size} індексів`);
console.log();

if (!problems.length) {
  console.log(SETTLES
    ? '  збігаються — схема стала на місце з першого проходу'
    : '  збігаються — новий клієнт отримає ту саму схему');
  process.exit(0);
}
for (const p of problems) console.log(`  ✗ ${p}`);
console.log();
console.log(`  ${problems.length} розбіжностей.`);
if (SETTLES) {
  console.log('  Схема не стала на місце з першого проходу: те, що новий клієнт');
  console.log('  отримає одразу, відрізняється від того, що він матиме після');
  console.log('  першого ж перезапуску. Найчастіша причина — перебудова таблиці,');
  console.log('  яка зносить індекси, а `CREATE ... IF NOT EXISTS` повертає їх');
  console.log('  лише наступного разу.');
} else {
  console.log('  Міграція, написана як «оновити з попереднього стану», не');
  console.log('  виконується на порожній базі — а видалення в кінці не скасовує');
  console.log('  створення вище.');
}
process.exit(1);
