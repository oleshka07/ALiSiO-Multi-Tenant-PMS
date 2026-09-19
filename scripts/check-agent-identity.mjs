/**
 * Обліковий запис Windows, названий ІМЕНЕМ, а не SID.
 *
 *   node scripts/check-agent-identity.mjs [--strict]
 *
 * ── Що сталося ──────────────────────────────────────────────────────────────
 *
 * `apps/winhotel-agent/install.ps1` ставив права на файл токена так:
 *
 *   foreach ($who in @('BUILTIN\Administrators', 'NT AUTHORITY\SYSTEM'))
 *
 * 18.09.2026 його вперше запустили на сервері готелю. Windows там німецька,
 * і ці записи звуться `VORDEFINIERT\Administratoren` і `NT-AUTORITÄT\SYSTEM`.
 * Англійські імена не розвʼязуються — `IdentityNotMappedException`, установка
 * падає на першій же дії. Наступним рядком чекало те саме:
 * `New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM'`.
 *
 * ── Що стверджується, і чому саме це ────────────────────────────────────────
 *
 * Спокуса — заборонити два рядки, `BUILTIN\` і `NT AUTHORITY\`. Це був би
 * ВІЗЕРУНОК (AGENTS §3.2.1): щоб він спрацював, автор мусив би заздалегідь
 * знати всі способи написати ту саму помилку — а їх стільки, скільки мов у
 * Windows, плюс `NTAccount`, плюс голе `'Administrators'`, плюс `'.\Admin'`.
 *
 * Тому стверджується ВЛАСТИВІСТЬ: **особа, яку скрипт передає Windows,
 * називається SID-ом.** Дві осі, і обидві механічні:
 *
 *   A. У скрипті немає жодного рядкового літерала виду `ДОМЕН\Запис`. Ця
 *      форма локалізована за побудовою — у будь-якій мові, не лише в цих
 *      двох; шляхи (`C:\…`), реєстр (`HKLM:\…`) і `..\` під неї не підпадають.
 *
 *   B. Кожен аргумент API, який РОЗВʼЯЗУЄ імена, — це літерал `S-1-…`
 *      (можливо, у змінній, чиї всі присвоєння теж лише SID-и):
 *      `New-ScheduledTaskPrincipal -UserId/-GroupId`, конструктори
 *      `FileSystemAccessRule`/`FileSystemAuditRule`/`RegistryAccessRule`.
 *      `NTAccount(` — знахідка завжди: цей тип іменний за визначенням.
 *
 * Вісь A ловить локалізовану назву де завгодно, вісь B — голе `'SYSTEM'` або
 * `NTAccount`, яких вісь A не бачить. Разом вони закривають клас, а не два
 * рядки з 18.09.
 *
 * Клас — «написане не доїхало до працюючої системи» (INC-050): скрипт лежав
 * у дереві тиждень, читався очима, був описаний у README — і на першій же
 * чужій машині не виконався жодного разу.
 *
 * Коментарі вирізаються ПЕРЕД пошуком (AGENTS §4) — інакше гейт червонів би
 * від власного пояснення вище, у якому обидва зламані імені названі дослівно.
 */
import fs from 'node:fs';
import path from 'node:path';

const strict = process.argv.includes('--strict');
const DIR = 'apps/winhotel-agent';

/**
 * Сканер PowerShell рівно настільки, наскільки треба: де коментар, де рядок.
 *
 * Повертає два тексти ТІЄЇ САМОЇ довжини, що й вихідний, — щоб зміщення
 * збігались:
 *   code   — коментарі забиті пробілами, рядки на місці;
 *   masked — те саме, але ВМІСТ рядків забитий підкресленням, тож дужка або
 *            кома всередині літерала не плутає розбір нижче.
 * І список літералів із рядком, у якому кожен стоїть.
 *
 * Свій сканер, а не регулярка, бо саме тут уже вмирали гейти: `check-bare-node`
 * відкрив «блоковий коментар» на рядку `'/*'` і зʼїв 60 рядків разом із тим,
 * що мав стерегти (AGENTS §3.2.1).
 */
function scan(src) {
  const code = src.split('');
  const masked = src.split('');
  const literals = [];

  let i = 0;
  let line = 1;
  const blank = (at, ch) => {
    if (src[at] !== '\n') {
      code[at] = ch;
      masked[at] = ch;
    }
  };
  const maskOnly = (at) => {
    if (src[at] !== '\n') masked[at] = '_';
  };

  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }

    // Блоковий коментар <# … #>
    if (c === '<' && src[i + 1] === '#') {
      while (i < src.length && !(src[i] === '#' && src[i + 1] === '>')) {
        if (src[i] === '\n') line++;
        blank(i, ' ');
        i++;
      }
      blank(i, ' '); blank(i + 1, ' ');
      i += 2;
      continue;
    }

    // Рядковий коментар
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') { blank(i, ' '); i++; }
      continue;
    }

    // Here-string @' … '@ / @" … "@
    if (c === '@' && (src[i + 1] === "'" || src[i + 1] === '"')) {
      const q = src[i + 1];
      const end = src.indexOf(`\n${q}@`, i + 2);
      const stop = end === -1 ? src.length : end + 3;
      for (let k = i; k < stop; k++) {
        if (src[k] === '\n') line++;
        maskOnly(k);
      }
      literals.push({ value: src.slice(i + 2, end === -1 ? src.length : end), line, start: i });
      i = stop;
      continue;
    }

    // Рядки
    if (c === "'" || c === '"') {
      const startLine = line;
      const start = i;
      const quote = c;
      i++;
      let value = '';
      while (i < src.length) {
        const ch = src[i];
        if (ch === '\n') line++;
        if (quote === '"' && ch === '`') { value += src[i + 1] ?? ''; maskOnly(i); maskOnly(i + 1); i += 2; continue; }
        if (ch === quote) {
          if (src[i + 1] === quote) { value += quote; maskOnly(i); maskOnly(i + 1); i += 2; continue; }
          i++;
          break;
        }
        value += ch;
        maskOnly(i);
        i++;
      }
      literals.push({ value, line: startLine, start });
      continue;
    }

    i++;
  }

  return { code: code.join(''), masked: masked.join(''), literals };
}

/** `ДОМЕН\Запис` — форма, яка залежить від мови системи. */
function isDomainAccount(value) {
  const parts = value.split('\\');
  if (parts.length !== 2) return false;          // шлях або реєстр — не це
  const [domain, account] = parts;
  if (!domain || !account) return false;         // '..\' і подібні
  if (/[:/]/.test(value)) return false;          // 'C:\…', 'HKLM:\…'
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .\-_]*$/u.test(domain)) return false;
  if (!/^[\p{L}\p{N} .\-_$]+$/u.test(account)) return false;
  if (/\.[\p{L}\p{N}]{1,4}$/u.test(account)) return false; // схоже на імʼя файла
  return true;
}

const isSidLiteral = (v) => /^S-1-[0-9-]+$/.test(v.trim());

/**
 * Приведення до типу, який Windows розуміє як SID, у будь-якому написанні:
 * `[SecurityIdentifier]`, `[Security.Principal.SecurityIdentifier]`,
 * `[System.Security.Principal.SecurityIdentifier]`.
 */
const SID_CAST = /\[\s*(?:System\.)?(?:Security\.Principal\.)?SecurityIdentifier\s*\]\s*$/i;
/** `New-Object …SecurityIdentifier(` — та сама особа, інше написання. */
const SID_CTOR = /SecurityIdentifier\s*\(\s*$/i;

/** Провідне приведення виразу: `[X]решта` → { cast:'[X]', rest:'решта' }. */
function castOf(arg) {
  const m = /^\s*(\[[^\]]*\])\s*/.exec(arg);
  return m ? { cast: m[1].trim(), rest: arg.slice(m[0].length) } : { cast: null, rest: arg.trim() };
}

/**
 * Чи КОЖЕН рядковий літерал виразу і є SID-ом, і побудований як SID.
 *
 * Друга половина — суть INC-051. `isSidLiteral` стереже ВІЗЕРУНОК («текст
 * схожий на SID»), а властивість інша: «Windows розвʼяже цю особу в ЦЬОМУ
 * API». Для конструкторів правил доступу голий рядок її не має — перевантаження
 * `FileSystemAccessRule(string identity, …)` трактує рядок як ІМʼЯ облікового
 * запису у формі `DOMAIN\account` (документація .NET), тобто будує
 * `NTAccount('S-1-5-18')`, а такого імені не існує: `IdentityNotMappedException`
 * — рівно та відмова, по якій цей гейт заводили.
 *
 * Тому тут дивимось, що стоїть ПЕРЕД літералом: приведення або конструктор.
 */
function sidTyped(expr) {
  const lits = scan(expr).literals;
  if (!lits.length) return false;
  return lits.every((l) => {
    if (!isSidLiteral(l.value)) return false;
    const before = expr.slice(0, l.start);
    return SID_CAST.test(before) || SID_CTOR.test(before);
  });
}

/** Чи кожен літерал виразу — SID (як його побудовано, тут не питається). */
function sidValued(expr) {
  const lits = scan(expr).literals;
  if (!lits.length) return false;
  return lits.every((l) => isSidLiteral(l.value));
}

/** Текст у дужках, що починаються на позиції `open`, з урахуванням вкладеності. */
function balanced(masked, source, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** Літерали всередині шматка коду (той самий сканер — рекурсія на рівні тексту). */
const literalsOf = (fragment) => scan(fragment).literals.map((l) => l.value);

// Дві підказки, а не одна, і це не косметика. Стара казала «передайте SID:
// 'S-1-5-18' АБО [SecurityIdentifier]'S-1-5-32-544'» — тобто вела в дефект:
// наступний, хто зламав би ACL і прочитав підказку, написав би голий рядок і
// дістав зелене (INC-051). Підказка — частина гейта, і неправильна підказка
// шкодить так само, як пропущена знахідка.
const FIX_TYPED = "у конструкторі правила доступу — [Security.Principal.SecurityIdentifier]'S-1-5-32-544'; "
  + 'ГОЛИЙ РЯДОК тут означає імʼя облікового запису, і SID у ньому не розвʼязується';
const FIX_VALUE = "-UserId приймає і рядок SID ('S-1-5-18'), і [SecurityIdentifier]; "
  + 'імʼя облікового запису — ні: воно локалізоване';

const findings = [];
let identitySites = 0;
let files = 0;

const entries = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.ps1')).sort()
  : [];

if (!entries.length) {
  console.log('check-agent-identity');
  console.log(`  ✗ у ${DIR} немає жодного .ps1 — гейт не має що перевіряти`);
  process.exit(strict ? 1 : 0);
}

for (const entry of entries) {
  const file = path.join(DIR, entry);
  const src = fs.readFileSync(file, 'utf8');
  const { code, masked, literals } = scan(src);
  files++;

  // ── Вісь A: локалізоване імʼя облікового запису будь-де ──────────────────
  for (const lit of literals) {
    if (isDomainAccount(lit.value)) {
      findings.push({
        file,
        line: lit.line,
        what: `'${lit.value}' — імʼя облікового запису, а не SID`,
        fix: 'well-known запис називається SID-ом: S-1-5-32-544 (Administrators), S-1-5-18 (SYSTEM)',
      });
    }
  }

  const lineAt = (offset) => src.slice(0, offset).split('\n').length;

  // ── Вісь B.1: конструктори правил доступу і NTAccount ────────────────────
  const CTORS = [
    ['FileSystemAccessRule', 'перший аргумент — особа'],
    ['FileSystemAuditRule', 'перший аргумент — особа'],
    ['RegistryAccessRule', 'перший аргумент — особа'],
  ];
  for (const [name, note] of CTORS) {
    const re = new RegExp(`${name}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const inner = balanced(masked, code, open);
      if (inner === null) continue;
      const innerMasked = balanced(masked, masked, open) ?? '';
      const comma = innerMasked.indexOf(',');
      const arg = (comma === -1 ? inner : inner.slice(0, comma)).trim();
      identitySites++;
      const verdict = identityVerdict(arg, code, masked, 'typed');
      if (verdict) findings.push({ file, line: lineAt(m.index), what: `${name}: ${verdict} (${note})`, fix: FIX_TYPED });
    }
  }

  // NTAccount розвʼязує саме імʼя — сам тип і є помилкою.
  for (const m of masked.matchAll(/NTAccount\s*\(/g)) {
    identitySites++;
    findings.push({
      file,
      line: lineAt(m.index),
      what: 'NTAccount — тип, який розвʼязує ІМʼЯ облікового запису',
      fix: 'візьміть [Security.Principal.SecurityIdentifier] із SID-ом',
    });
  }

  // ── Вісь B.2: -UserId / -GroupId у принципала запланованої задачі ────────
  for (const m of masked.matchAll(/-(UserId|GroupId)\s+(\S+)/g)) {
    const arg = code.slice(m.index + m[0].length - m[2].length, m.index + m[0].length).trim();
    identitySites++;
    const verdict = identityVerdict(arg, code, masked, 'value');
    if (verdict) {
      findings.push({ file, line: lineAt(m.index), what: `-${m[1]}: ${verdict}`, fix: FIX_VALUE });
    }
  }
}

/**
 * null — усе гаразд; інакше речення про те, чому Windows цю особу не розвʼяже.
 *
 * `mode` — ВЛАСТИВІСТЬ, якої вимагає саме це API, і вона різна:
 *
 *   'typed'  конструктори правил доступу. Потрібен `[SecurityIdentifier]`:
 *            перевантаження з рядком — це імʼя облікового запису.
 *   'value'  `New-ScheduledTaskPrincipal -UserId`. Приймає і голий рядок
 *            SID — доведено живцем на сервері готелю 18.09.2026, установка
 *            пройшла саме з ним, — і `[SecurityIdentifier]` (він приводиться
 *            до тієї самої форми `S-1-…`). Не приймає ІМЕНІ: воно локалізоване.
 *
 * Одне правило на обидва місця було б неправильним в один бік або в другий:
 * суворе зламало б робочу установку, мʼяке пропускає справжній дефект.
 */
function identityVerdict(arg, code, masked, mode) {
  const { cast, rest } = castOf(arg.trim());

  if (cast && /NTAccount/i.test(cast)) {
    return 'приведення до NTAccount — це ІМʼЯ облікового запису, не SID';
  }

  // Приведення до SecurityIdentifier робить типованою і змінну, і літерал.
  if (cast && SID_CAST.test(cast)) {
    const inner = scan(rest).literals;
    if (inner.length && !inner.every((l) => isSidLiteral(l.value))) {
      return `приведення до SecurityIdentifier над ${inner.map((l) => `'${l.value}'`).join(', ')} — це не SID, приведення кине помилку`;
    }
    if (inner.length) return null;
    // `[SecurityIdentifier]$var` — далі питаємо про саму змінну, вже мʼякше.
    mode = 'value';
  }

  const whole = cast ? `${cast}${rest}` : rest;
  const lits = literalsOf(rest);
  if (lits.length) {
    if (!lits.every(isSidLiteral)) {
      return `особа названа як ${lits.map((l) => `'${l}'`).join(', ')}`;
    }
    if (mode === 'typed' && !sidTyped(whole)) {
      return `особа задана ГОЛИМ РЯДКОМ ${lits.map((l) => `'${l}'`).join(', ')}: перевантаження з рядком трактує його як імʼя облікового запису (DOMAIN\\account), і SID у ньому не розвʼязується`;
    }
    return null;
  }

  const varName = /^\$([A-Za-z_]\w*)$/.exec(rest)?.[1];
  if (!varName) return `особу задає вираз \`${arg}\`, у якому SID не видно`;

  const bindings = [];
  // Присвоєння: до кінця рядка.
  for (const m of masked.matchAll(new RegExp(`\\$${varName}\\s*=\\s*`, 'g'))) {
    const from = m.index + m[0].length;
    const eol = code.indexOf('\n', from);
    bindings.push(code.slice(from, eol === -1 ? code.length : eol));
  }
  // foreach ($v in …): до парної дужки, бо перелік буває багаторядковим.
  for (const m of masked.matchAll(new RegExp(`foreach\\s*\\(\\s*\\$${varName}\\s+in\\b`, 'gi'))) {
    const open = masked.indexOf('(', m.index);
    const inner = balanced(masked, code, open);
    if (inner !== null) bindings.push(inner.replace(new RegExp(`^\\s*\\$${varName}\\s+in\\b`, 'i'), ''));
  }

  if (!bindings.length) return `особа приходить зі змінної \`$${varName}\`, якій гейт не бачить жодного присвоєння`;

  // Кожне присвоєння мусить витримати ТУ САМУ вимогу, що й місце виклику:
  // змінна не пом'якшує правила, вона лише переносить значення.
  const ok = mode === 'typed' ? sidTyped : sidValued;
  const bad = bindings.filter((b) => !ok(b));
  if (bad.length) {
    return mode === 'typed'
      ? `\`$${varName}\` отримує особу не як [SecurityIdentifier] (${bad.length} з ${bindings.length} присвоєнь) — рядок тут означає ІМʼЯ`
      : `\`$${varName}\` отримує не лише SID-и (${bad.length} з ${bindings.length} присвоєнь)`;
  }
  return null;
}

console.log('check-agent-identity');
if (findings.length === 0) {
  console.log(`  чисто — ${files} скрипт(ів), ${identitySites} місць, де називається особа Windows; усі SID-ом`);
  process.exit(0);
}

for (const f of findings) {
  console.log(`  ✗ ${f.file}:${f.line}`);
  console.log(`      ${f.what}`);
  console.log(`      → ${f.fix}`);
}
console.log(`\n  ${findings.length} — імена well-known записів локалізовані, SID-и ні.`);
console.log('  На чужій мові імʼя не розвʼязується: IdentityNotMappedException,');
console.log('  і установка агента падає на першій дії.');
process.exit(strict ? 1 : 0);
