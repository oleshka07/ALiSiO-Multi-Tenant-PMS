/**
 * Агент готелю — ЗАПУЩЕНИЙ, а не прочитаний.
 *
 *   node scripts/check-agent-run.mjs        # потрібен pwsh (є на ubuntu-runner)
 *   PWSH=/шлях/до/pwsh node scripts/check-agent-run.mjs
 *
 * ── Що сталося ──────────────────────────────────────────────────────────────
 *
 * `winhotel-agent.ps1` має параметр `[ValidateSet('Snapshot','Delta')]$Mode`.
 * Нижче, у тілі, ТЕ САМЕ імʼя використовувалось для іншої суті — яким способом
 * знімок узято (backup | gbak | copy), і починалось воно з `$Mode = $null`.
 *
 * PowerShell перевіряє ValidateSet при КОЖНОМУ присвоєнні, не лише при
 * зв'язуванні параметра. `$null` у `[string]` стає порожнім рядком, порожнього
 * рядка в наборі немає — завершальна помилка. Вона трапляється ДО блоку
 * `try{}`, тож у протокол не лягає нічого, і процес виходить з кодом 1.
 *
 * Тобто нічний знімок не працював НІКОЛИ Й НІДЕ — від першого дня. Дельта
 * працювала, бо тієї гілки не досягає. Знайшлось це лише тоді, коли агента
 * вперше поставили на живий сервер готелю (18.09.2026), і жоден гейт цього не
 * бачив за побудовою: PowerShell ніхто не виконував — його читали.
 *
 * ── Що стверджується ────────────────────────────────────────────────────────
 *
 * Скрипт доходить до ВІДПРАВКИ і відмовляє саме на ній:
 *
 *   1. код виходу 4 — названа відмова «Upload nicht gelungen», а не 1;
 *   2. сервер ОТРИМАВ рівно один POST на /api/apps/winhotel-import/snapshots;
 *   3. заголовки називають режим, токен і хост;
 *   4. sha256 тіла збігається з тим, що агент написав у заголовку;
 *   5. розпакований gzip побайтово дорівнює тому .fbk, який агент мав обрати.
 *
 * Пʼятого достатньо, щоб фікстура не була виродженою (AGENTS §26): у теці
 * бекапів ДВА файли різного вмісту й різного віку — свіжий (< 24 год) і
 * позавчорашній. Твердження про вміст арифметично несумісне з вибором не того
 * файла: довжини різні, байти різні. З одним файлом воно було б зеленим і в
 * агента, який бере перший-ліпший.
 *
 * ── Чого цей прохід НЕ доводить, і це важливо ───────────────────────────────
 *
 * Він біжить на Linux, тож не бачить нічого специфічного для Windows: ACL на
 * agent.token, реєстрацію запланованої задачі, `gbak -b`, `isql`. Режими (b) і
 * (c) не досягаються за побудовою — мода (a) успішна. Ті осі тримає
 * `check-agent-identity` (імена облікових записів) і живий сервер готелю.
 * `$env:TEMP` і `$env:COMPUTERNAME` підставляються: на Windows вони є завжди,
 * і без них скрипт помер би на `Join-Path $env:TEMP`, тобто з причини, якої на
 * цільовій машині не буває.
 *
 * Відповідь 401 замість відмови мережі — навмисно: агент виходить на 401 ОДРАЗУ
 * (`if ($code -in 400,401,404,409) { break }`), а недосяжна адреса коштувала б
 * 180 секунд сну між трьома спробами. І 401 доводить більше: запит справді
 * вийшов у мережу цілим, з тілом і заголовками, які можна звірити.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';

const AGENT = path.resolve('apps/winhotel-agent/winhotel-agent.ps1');
const TOKEN = 'check-agent-run-token';
const HOSTNAME = 'alisio-check';
const TIMEOUT_MS = 120_000;

// ── pwsh ────────────────────────────────────────────────────────────────────
function findPwsh() {
  const candidates = [process.env.PWSH, 'pwsh', 'pwsh.exe', 'powershell.exe'].filter(Boolean);
  for (const exe of candidates) {
    const probe = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], {
      stdio: 'ignore',
      timeout: 30_000,
    });
    if (!probe.error && probe.status === 0) return exe;
  }
  return null;
}

const fail = (message, detail) => {
  console.log('check-agent-run');
  console.log(`  ✗ ${message}`);
  if (detail) console.log(detail.replace(/^/gm, '      '));
  process.exit(1);
};

const pwsh = findPwsh();
if (!pwsh) {
  fail(
    'PowerShell не знайдено (pwsh / powershell.exe)',
    'Цей гейт ЗАПУСКАЄ агента, а не читає його. Без PowerShell він нічого не\n' +
      'доводить, і мовчазний пропуск був би гіршим за відсутність гейта.\n' +
      'На ubuntu-раннерах pwsh є; локально: PWSH=/шлях/до/pwsh npm run check:agent',
  );
}

if (!fs.existsSync(AGENT)) fail(`не знайдено ${AGENT}`);

// ── Фікстура ────────────────────────────────────────────────────────────────
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-agent-check-'));
const backupDir = path.join(work, 'backup');
const dataDir = path.join(work, 'daten');
const tempDir = path.join(work, 'temp');
for (const d of [backupDir, dataDir, tempDir]) fs.mkdirSync(d, { recursive: true });

// Два бекапи, різні за віком І за вмістом — вісь «який саме файл» (AGENTS §26).
const staleBytes = Buffer.alloc(4096, 0x41);   // позавчорашній
const freshBytes = Buffer.alloc(9001, 0x5a);   // вчорашній-сьогоднішній
const stale = path.join(backupDir, 'winhotel-stale.fbk');
const fresh = path.join(backupDir, 'winhotel-fresh.fbk');
fs.writeFileSync(stale, staleBytes);
fs.writeFileSync(fresh, freshBytes);
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000);
fs.utimesSync(stale, hoursAgo(48), hoursAgo(48));
fs.utimesSync(fresh, hoursAgo(1), hoursAgo(1));

// Сама база: агент мусить її БАЧИТИ (інакше вихід 2), але в режимі (a) не чіпає.
const database = path.join(dataDir, 'winhotel.fdb');
const databaseBytes = Buffer.alloc(2048, 0x7e);
fs.writeFileSync(database, databaseBytes);

const logFile = path.join(work, 'winhotel-agent.log');

// ── Сервер, який відмовляє 401 ──────────────────────────────────────────────
const received = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Kein gültiges Token' }));
  });
});

const cleanup = () => {
  try { server.close(); } catch { /* закритий */ }
  fs.rmSync(work, { recursive: true, force: true });
};

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

// ── Прогін ──────────────────────────────────────────────────────────────────
const args = [
  '-NoProfile', '-NonInteractive', '-File', AGENT,
  '-AlisioUrl', `http://127.0.0.1:${port}`,
  '-Token', TOKEN,
  '-Database', database,
  '-BackupDir', backupDir,
  '-LogFile', logFile,
];

const run = await new Promise((resolve) => {
  const child = spawn(pwsh, args, {
    env: {
      ...process.env,
      // Дві змінні, які на Windows є завжди; без них скрипт помер би з причини,
      // якої на цільовій машині не існує.
      TEMP: tempDir,
      TMP: tempDir,
      COMPUTERNAME: HOSTNAME,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, TIMEOUT_MS);
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    resolve({ code, signal, out, err });
  });
});

const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
const transcript =
  `код виходу: ${run.code}${run.signal ? ` (сигнал ${run.signal})` : ''}\n` +
  `запитів до сервера: ${received.length}\n` +
  `--- stdout ---\n${run.out.trim() || '(порожньо)'}\n` +
  `--- stderr ---\n${run.err.trim() || '(порожньо)'}\n` +
  `--- протокол ---\n${log.trim() || '(порожньо)'}`;

const problems = [];
const claim = (ok, text) => { if (!ok) problems.push(text); };

// 1. Названа відмова відправки, а не «щось упало».
claim(
  run.code === 4,
  `код виходу ${run.code}, чекали 4 (Fail 'Upload nicht gelungen'). ` +
    (run.code === 1
      ? 'Рівно так виглядав дефект 18.09: завершальна помилка ДО try{}, порожній протокол.'
      : 'Агент не дійшов до відправки.'),
);

// 2–5. Те, що справді вийшло в мережу.
if (received.length !== 1) {
  claim(false, `сервер отримав ${received.length} запит(ів), чекали 1 — знімок не доїхав до відправки`);
} else {
  const req = received[0];
  const h = req.headers;
  claim(req.method === 'POST', `метод ${req.method}, чекали POST`);
  claim(
    req.url === '/api/apps/winhotel-import/snapshots',
    `шлях ${req.url}, чекали /api/apps/winhotel-import/snapshots`,
  );
  claim(h.authorization === `Bearer ${TOKEN}`, `заголовок Authorization: ${h.authorization}`);
  claim(h['content-type'] === 'application/gzip', `Content-Type: ${h['content-type']}, чекали application/gzip`);
  claim(h['x-winhotel-mode'] === 'backup', `X-Winhotel-Mode: ${h['x-winhotel-mode']}, чекали backup (режим (a))`);
  claim(h['x-winhotel-hostname'] === HOSTNAME, `X-Winhotel-Hostname: ${h['x-winhotel-hostname']}`);
  claim(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(h['x-winhotel-taken-at'] ?? ''),
    `X-Winhotel-Taken-At: ${h['x-winhotel-taken-at']} — не час знімка в UTC`,
  );

  const sha = crypto.createHash('sha256').update(req.body).digest('hex');
  claim(
    sha === h['x-winhotel-sha256'],
    `sha256 тіла ${sha.slice(0, 12)}… не збігається із заголовком ${String(h['x-winhotel-sha256']).slice(0, 12)}…`,
  );

  let unpacked = null;
  try {
    unpacked = zlib.gunzipSync(req.body);
  } catch (e) {
    claim(false, `тіло не розпаковується як gzip: ${e.message}`);
  }
  if (unpacked) {
    // Вісь «який саме бекап»: свіжий, не позавчорашній і не сама база.
    const which = unpacked.equals(freshBytes)
      ? 'fresh'
      : unpacked.equals(staleBytes)
        ? 'stale'
        : unpacked.equals(databaseBytes)
          ? 'fdb'
          : 'невідоме';
    claim(
      which === 'fresh',
      `надіслано ${which === 'невідоме' ? `${unpacked.length} байт, що не збігаються з жодним файлом фікстури` : `${which}`}, ` +
        'чекали вміст СВІЖОГО .fbk (< 24 год)',
    );
  }
}

// 6. Протокол: агент мусить сказати, яким шляхом узяв знімок.
claim(/Modus \(a\)/.test(log), 'у протоколі немає рядка про режим (a) — агент не назвав, звідки взяв знімок');
claim(log.includes('winhotel-fresh.fbk'), 'у протоколі не названо файл, який агент обрав');
claim(!log.includes(TOKEN), 'ТОКЕН потрапив у протокол — його не можна логувати');

cleanup();

console.log('check-agent-run');
if (problems.length === 0) {
  console.log(`  чисто — ${pwsh}: агент дійшов до відправки, POST вийшов цілим,`);
  console.log('  sha256 зійшовся, у тілі — свіжий .fbk, вихід 4 на відмові сервера');
  process.exit(0);
}
for (const p of problems) console.log(`  ✗ ${p}`);
console.log('');
console.log(transcript.replace(/^/gm, '      '));
process.exit(1);
