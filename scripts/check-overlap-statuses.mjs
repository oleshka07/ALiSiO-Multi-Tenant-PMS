/**
 * Список статусів, за яких бронь НЕ тримає кімнату, — один і той самий у коді
 * і в обмеженні бази (INC-045).
 *
 *   node scripts/check-overlap-statuses.mjs [--strict]
 *   DATABASE_URL=… node scripts/check-overlap-statuses.mjs --strict   # ще й жива вісь
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * `FREES_THE_ROOM = "('cancelled', 'no_show')"` живе в
 * `src/modules/bookings/data/conflicts.repo.ts` рядком TypeScript. Обмеження
 * `no_double_booking` носить ДРУГУ копію того самого списку — у своєму
 * предикаті. Копії розійдуться при першому ж новому статусі: хтось додасть
 * `'expired'` у код, база про це не дізнається, і кімната стане водночас
 * вільною (для перевірки перед записом) і зайнятою (для обмеження). Поведінка
 * почне залежати від того, який шлях запису спрацював, — а шляхів шість.
 *
 * Це той самий клас, що два списки в одному файлі, від якого нас берегла
 * єдина константа. Тут єдиної константи бути не може: SQL міграції не імпортує
 * TypeScript. Тому копії лишаються дві, а гейт стереже їхню рівність.
 *
 * ── Що саме стверджується (властивість, не візерунок) ───────────────────
 *
 * 1. МНОЖИНА статусів у коді дорівнює множині статусів у предикаті обмеження.
 *    Не «текст збігається»: `NOT IN ('a','b')` і `<> ALL (ARRAY['b','a'])` —
 *    те саме твердження двома записами, і Postgres віддає саме друге, хоч
 *    міграція писала перше. Гейт, що звіряв би текст, червонів би завжди.
 * 2. ПОЛЯРНІСТЬ: предикат мусить статуси ВИКЛЮЧАТИ. Множини рівні й тоді,
 *    коли `NOT IN` випадково став `IN`, — а це переверне сенс обмеження
 *    цілком: воно почне забороняти перетин лише скасованим броням.
 *
 * ── Копій три, не дві ───────────────────────────────────────────────────
 *
 * Список живе в трьох місцях, і кожне з них потрібне окремо:
 *
 *   код          `conflicts.repo.ts` — перевірка ПЕРЕД записом і людський текст;
 *   міграція     `0132` — оновлює базу, яка вже існує;
 *   генератор    `pg-schema.mjs` — створює базу НОВОГО клієнта, бо SQLite
 *                `EXCLUDE` не має і переказати його з неї нічим.
 *
 * Третя копія зʼявилась не з примхи: без неї `check-schema-drift` сказав
 * «новий клієнт заведеться БЕЗ цього» — обмеження стояло лише в міграції.
 *
 * ── Осі ─────────────────────────────────────────────────────────────────
 *
 * Статичні (є завжди): код проти міграції і код проти генератора.
 * Жива (лише коли є `DATABASE_URL`): код проти `pg_get_constraintdef` —
 * тобто проти того, що в базі СПРАВДІ лежить. Розійтися вони можуть просто:
 * міграцію правлять, а накотити забувають, і на живій базі стоїть учорашній
 * предикат. Саме через це AGENTS §4 вимагає перевіряти наявність констрейнта
 * за ОЗНАЧЕННЯМ, а не за іменем.
 *
 * Коли живої осі немає, гейт каже про це вголос, а не мовчить: твердження,
 * яке має сенс лише під Postgres, мусить саме називати, коли осі немає.
 */
import fs from 'node:fs';

const STRICT = process.argv.includes('--strict');
const CODE = 'src/modules/bookings/data/conflicts.repo.ts';
const MIGRATION = 'db/postgres/migrations/0133-two-guests-do-not-share-one-room-for-one-night.sql';
const GENERATOR = 'scripts/pg-schema.mjs';
const CONSTRAINT = 'no_double_booking';
const COLUMN = 'status';

const problems = [];
const notes = [];

/**
 * Вирізати коментарі — інакше перевірка рахує власну документацію.
 *
 * Тут це не теорія: шапка `0132` цитує `FREES_THE_ROOM = "('cancelled',
 * 'no_show')"` дослівно, пояснюючи, навіщо цей гейт існує. Без вирізання гейт
 * знаходив би список у коментарі й зеленів би, навіть якби в самому
 * `ALTER TABLE` не було жодного статусу.
 */
function stripComments(text, { sql }) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  out = out.replace(sql ? /--[^\n]*/g : /\/\/[^\n]*/g, ' ');
  return out;
}

/** Літерали в лапках із фрагмента SQL, без `::text` і зайвих пробілів. */
function literals(fragment) {
  return [...fragment.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

/**
 * Множина статусів і полярність із будь-якого запису предиката.
 *
 * ── Форм більше, ніж здається, і всі трапляються по-справжньому ─────────
 *
 * Міграція пише `status NOT IN ('a','b')`; `pg_get_constraintdef` віддає те
 * саме як `status <> ALL (ARRAY['a'::text, 'b'::text])`; а СПИСОК З ОДНОГО
 * Postgres згортає ще далі — у скаляр `status <> 'a'`.
 *
 * Останнє коштувало окремого відкриття: гейт ловив розбіжність (це добре), але
 * казав «немає жодної згадки status у списковій формі» замість «у базі лежить
 * інший список» — тобто називав ВИГАДАНУ причину. Це рівно клас Ц49
 * (`db-names.check`), де рід відмови судили за текстом. Червоне з неправильним
 * поясненням — це наступна година чужого часу, витрачена не туди.
 *
 * Тому форма тут не вгадується списком візерунків, а розбирається: знайти
 * оператор при колонці, визначити його полярність, і взяти те, що за ним, —
 * дужку зі списком або один літерал. Список із одного — теж список.
 */
function statusesIn(definition, where) {
  const OPERATORS = /(?<![\w.])"?(?:\w+\.)?COLUMN"?\s*(NOT\s+IN|<>\s*ALL|=\s*ANY|IN|<>|!=|=)\s*/i;
  const re = new RegExp(OPERATORS.source.replace('COLUMN', COLUMN), 'i');
  const found = definition.match(re);
  if (!found) return { error: `у ${where} немає жодного порівняння за "${COLUMN}"` };

  const op = found[1].replace(/\s+/g, ' ').toUpperCase();
  const negated = op === 'NOT IN' || op === '<> ALL' || op === '<>' || op === '!=';
  const tail = definition.slice(found.index + found[0].length);

  // Дужка зі списком — або один літерал одразу за оператором.
  let fragment;
  if (tail.startsWith('(')) {
    let depth = 0;
    let close = -1;
    for (let i = 0; i < tail.length; i++) {
      if (tail[i] === '(') depth++;
      else if (tail[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) return { error: `у ${where} дужка після "${COLUMN}" не закрита` };
    fragment = tail.slice(0, close + 1);
  } else if (tail.startsWith("'")) {
    fragment = tail.slice(0, tail.indexOf("'", 1) + 1);
  } else {
    return { error: `у ${where} за "${COLUMN} ${op}" немає ні списку, ні літерала` };
  }

  const statuses = literals(fragment);
  if (!statuses.length) return { error: `у ${where} список статусів порожній` };
  return { statuses: new Set(statuses), negated };
}

const same = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));
const show = (set) => `(${[...set].sort().map((s) => `'${s}'`).join(', ')})`;

// ── 1. Код ──────────────────────────────────────────────────────────────────
const codeText = stripComments(fs.readFileSync(CODE, 'utf8'), { sql: false });
const assignment = codeText.match(/FREES_THE_ROOM\s*=\s*(["'`])([\s\S]*?)\1/);
let fromCode = null;
if (!assignment) {
  problems.push(`${CODE}: не знайдено присвоєння FREES_THE_ROOM — гейт не має що звіряти`);
} else {
  const found = literals(assignment[2]);
  if (!found.length) problems.push(`${CODE}: FREES_THE_ROOM не містить жодного статусу`);
  else fromCode = new Set(found);
}

// ── 2. Текст міграції — те, що дістає база, яка вже існує ───────────────────
const migrationText = stripComments(fs.readFileSync(MIGRATION, 'utf8'), { sql: true });
const added = migrationText.indexOf(CONSTRAINT);
if (added < 0) {
  problems.push(`${MIGRATION}: обмеження "${CONSTRAINT}" не створюється — гейт стеріг би порожнечу`);
} else if (fromCode) {
  const statement = migrationText.slice(added, migrationText.indexOf(';', added));
  const parsed = statusesIn(statement, `міграції ${MIGRATION}`);
  if (parsed.error) problems.push(parsed.error);
  else {
    if (!same(fromCode, parsed.statuses)) {
      problems.push(`списки розійшлися: у коді ${show(fromCode)}, у міграції ${show(parsed.statuses)}`);
    }
    if (!parsed.negated) {
      problems.push(`міграція статуси не ВИКЛЮЧАЄ: обмеження діятиме лише на них, тобто навпаки`);
    }
  }
}

// ── 3. Генератор схеми — те, з чого заводиться НОВИЙ клієнт ─────────────────
const generatorText = stripComments(fs.readFileSync(GENERATOR, 'utf8'), { sql: false });
const declared = generatorText.indexOf(CONSTRAINT);
if (declared < 0) {
  problems.push(`${GENERATOR}: обмеження "${CONSTRAINT}" не оголошено — `
    + 'схема нового клієнта не матиме його, і це побачить лише check-schema-drift');
} else if (fromCode) {
  // До кінця оголошення: у генераторі це рядок JS, тож межа — закривна дужка
  // елемента списку, а не крапка з комою SQL.
  const parsed = statusesIn(generatorText.slice(declared, declared + 2000), `генераторі ${GENERATOR}`);
  if (parsed.error) problems.push(parsed.error);
  else {
    if (!same(fromCode, parsed.statuses)) {
      problems.push(`генератор розійшовся з кодом: у коді ${show(fromCode)}, `
        + `у ${GENERATOR} ${show(parsed.statuses)}`);
    }
    if (!parsed.negated) problems.push(`${GENERATOR}: статуси не ВИКЛЮЧАЮТЬСЯ, а вимагаються`);
  }
}

// ── 4. Жива база, якщо вона є ───────────────────────────────────────────────
if (!process.env.DATABASE_URL || process.env.DB_DRIVER === 'pglite') {
  notes.push('живої осі немає (без DATABASE_URL): звірено лише код проти ТЕКСТУ міграції — '
    + 'база могла лишитись з учорашнім предикатом, і цього тут не видно');
} else if (fromCode) {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      'SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1', [CONSTRAINT]);
    if (!rows.length) {
      problems.push(`у живій базі немає обмеження "${CONSTRAINT}" — міграцію не накотили`);
    } else {
      const parsed = statusesIn(rows[0].def, 'живому обмеженні');
      if (parsed.error) problems.push(parsed.error);
      else {
        if (!same(fromCode, parsed.statuses)) {
          problems.push(`жива база розійшлася з кодом: у коді ${show(fromCode)}, `
            + `у базі ${show(parsed.statuses)}`);
        }
        if (!parsed.negated) problems.push('живе обмеження статуси не ВИКЛЮЧАЄ, а вимагає');
        notes.push('жива вісь є: звірено з pg_get_constraintdef');
      }
    }
  } finally {
    await pool.end();
  }
}

for (const note of notes) console.log(`  · ${note}`);
if (problems.length) {
  console.error('\ncheck-overlap-statuses: список статусів у коді і в обмеженні бази РІЗНИЙ\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('\nОдин зі статусів звільняє кімнату лише на одному зі шляхів запису.\n');
  process.exit(STRICT ? 1 : 0);
}
console.log(`check-overlap-statuses: ${fromCode ? show(fromCode) : '—'} — один список у коді й у обмеженні`);
