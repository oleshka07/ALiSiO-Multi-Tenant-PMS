/**
 * Шлях, якому nginx дозволяє велике тіло, а Next ріже його на 10 МБ.
 *
 *   node scripts/check-body-limits.mjs [--strict]
 *
 * ── Що сталося ──────────────────────────────────────────────────────────────
 *
 * У `deploy/nginx/alisio.conf` є `location = /api/apps/winhotel-import/snapshots`
 * з `client_max_body_size 200m` і коментарем «gzip на ~80 МБ». Вимір на живому
 * готелі 18.09.2026 дав 81 738 КБ — автор коментаря вгадав до мегабайта.
 *
 * І це нічого не змінювало, бо на другому поверсі стояла друга стеля, про яку
 * ніхто не знав. `src/proxy.ts` має `matcher`, який ловить УСІ шляхи, а під
 * middleware Next буферизує тіло запиту (`getCloneableBody`) зі стелею 10 МБ:
 *
 *   Request body exceeded 10MB for /api/apps/winhotel-import/snapshots.
 *   Only the first 10MB will be available unless configured.
 *
 * Перевищення — НЕ відмова. Буфер мовчки обривається (`p1.push(null)`), маршрут
 * дістає перші 10 МБ із 80, і єдине, що про це каже, — попередження в лог.
 * Тобто навіть при відкритому nginx агент отримував би 400 (sha256 не зійшовся)
 * на кожен нічний знімок.
 *
 * ── Чому саме гейт, а не димова перевірка ───────────────────────────────────
 *
 * `deploy/smoke.sh` міряє стелю nginx ззовні на кожному деплої, і це правильне
 * місце для неї: 413 проти 401 видно з іншого кінця дроту. Стелю Next вона
 * НЕ бачить і не може: маршрут відмовляє по токену ДО читання тіла, тож із
 * завідомо невірним токеном відповідь 401 однакова — і коли middleware обрізав
 * тіло, і коли не чіпав. Перевірено в коді Next 16.2.12, а не за документацією.
 *
 * ── Що стверджується ────────────────────────────────────────────────────────
 *
 * Два твердження, обидва про ЗГОДУ двох файлів, які пишуть різні люди:
 *
 *   1. Кожен `location`, якому шаблон nginx дозволяє тіло понад стелю
 *      middleware (10 МБ), виключений з `matcher` у `src/proxy.ts`. Не «цей
 *      один шлях» — будь-який: наступний великий вивантажувач народиться з тим
 *      самим розривом, і гейт назве його першим же прогоном.
 *
 *   2. Такий `location` має власний `proxy_pass`, і його ПОРТ той самий, що в
 *      `location /` того ж серверного блоку. Порти тут різні за призначенням
 *      (прод 3130, бета 3131), і блок, скопійований з сусіднього серверного
 *      блоку разом із портом, відправляв би знімки бети в прод — мовчки,
 *      і саме на тому одному шляху, на якому це найдорожче.
 *
 * Клас — «написане не доїхало до працюючої системи» (INC-050).
 */
import fs from 'node:fs';

const strict = process.argv.includes('--strict');

// УСІ конфігурації nginx у дереві, а не один названий файл.
//
// INC-052. Перша редакція читала рівно `deploy/nginx/alisio.conf`, і цього
// було досить рівно доти, доки стелю оголошували там. Але
// `deploy/nginx/alisio-proxy.conf` інклюдиться в УСІ ЧОТИРИ `location /`
// (`alisio.conf:45, 50, 92, 97`), а `client_max_body_size` у контексті
// `location` цілком законна. Мутація контролера — дописати
// `client_max_body_size 300m;` у кінець сніпета — лишала гейт ЗЕЛЕНИМ, при
// тому що вікно тихого обрізання ставало 10…300 МБ для кожного маршруту
// обох середовищ. Тобто гейт стеріг ФАЙЛ, а не конфігурацію.
const NGINX_DIR = 'deploy/nginx';
const PROXY = 'src/proxy.ts';

// Стеля буфера тіла під middleware. `DEFAULT_BODY_CLONE_SIZE_LIMIT` у
// next/dist/server/body-streams.js; змінюється лише `proxyClientMaxBodySize`
// у next.config, якого ми свідомо не піднімаємо — це 200 МБ у памʼяті на
// сервері з 4 ГБ.
const NEXT_BODY_LIMIT = 10 * 1024 * 1024;

/**
 * Стеля СЕРВЕРНОГО блоку — не виняток для одного шляху, а межа для всіх, і
 * вона теж вища за буфер middleware. Тобто між 10 і 25 МБ є вікно тихого
 * обрізання для КОЖНОГО маршруту, не лише для знімків.
 *
 * Це відкрита річ, а не наслідок цієї задачі, і вона не зводиться до
 * «виключити шлях із matcher»: власна стеля `/api/file-upload` — рівно
 * 10 МБ (`file.size > 10 * 1024 * 1024`), а тіло multipart на межі завжди
 * трохи більше за сам файл. Тобто скан паспорта рівно на 10 МБ не доходить
 * цілим уже сьогодні, і виключити цей маршрут із matcher не можна — саме
 * middleware тримає на ньому перевірку сесії. Справжні ліки — або
 * `proxyClientMaxBodySize` у next.config (200 МБ у памʼяті на сервері з
 * 4 ГБ — свідомо ні), або нижча власна стеля завантаження.
 *
 * Тому число зафіксоване храповиком: підняти серверну стелю можна, але не
 * мовчки — гейт почервоніє і вимагатиме дописати сюди нове число, тобто
 * сказати вголос, що вікно розширили. Опис — docs/ARCHITECTURE.md,
 * «Лишається».
 */
const SERVER_DEFAULT_ACK = '25m';

function parseSize(text) {
  const m = /^(\d+)([kmg])?$/i.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  return n * (unit === 'g' ? 1024 ** 3 : unit === 'm' ? 1024 ** 2 : unit === 'k' ? 1024 : 1);
}

/** Коментарі nginx — `#` до кінця рядка, поза лапками. */
function stripComments(src) {
  let out = '';
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Серверні блоки з їхніми `location`. Розбір за дужками, а не регуляркою по
 * рядках: `location` вкладений у `server`, і саме належність до блоку тут і є
 * питанням (порт береться з того самого блоку, не з сусіднього).
 */
function parseNginx(src) {
  const text = stripComments(src);
  const servers = [];
  const stack = [];
  let buffer = '';

  const flushDirective = (target) => {
    const line = buffer.trim();
    buffer = '';
    if (!line || !target) return;
    const [name, ...rest] = line.split(/\s+/);
    const value = rest.join(' ');
    if (name === 'client_max_body_size') target.bodyLimit = parseSize(value);
    else if (name === 'proxy_pass') target.proxyPass = value;
    else if (name === 'server_name') target.serverName = value;
    else if (name === 'listen') (target.listen ||= []).push(value);
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      const header = buffer.trim();
      buffer = '';
      const block = { header, locations: [] };
      if (/^server$/.test(header)) {
        block.kind = 'server';
        servers.push(block);
      } else if (/^location\b/.test(header)) {
        block.kind = 'location';
        const parts = header.split(/\s+/).slice(1);
        block.op = parts.length > 1 ? parts[0] : '';
        block.path = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
        const server = [...stack].reverse().find((b) => b.kind === 'server');
        if (server) server.locations.push(block);
      } else {
        block.kind = 'other';
      }
      stack.push(block);
      continue;
    }
    if (c === '}') {
      flushDirective(stack[stack.length - 1]);
      stack.pop();
      continue;
    }
    if (c === ';') {
      flushDirective(stack[stack.length - 1]);
      continue;
    }
    buffer += c;
  }

  return servers;
}

/** Рядковий літерал JS → його значення. Лише ті екранування, що тут бувають. */
function jsUnescape(raw) {
  return raw.replace(/\\(.)/g, (_, ch) =>
    ch === 'n' ? '\n' : ch === 't' ? '\t' : ch === 'r' ? '\r' : ch,
  );
}

function matcherPatterns(source) {
  const block = /matcher:\s*\[([\s\S]*?)\]/.exec(source);
  if (!block) return null;
  const out = [];
  for (const m of block[1].matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) out.push(jsUnescape(m[2]));
  return out.length ? out : null;
}

const problems = [];

if (!fs.existsSync(NGINX_DIR)) problems.push({ what: `не знайдено теки ${NGINX_DIR}` });
if (!fs.existsSync(PROXY)) problems.push({ what: `не знайдено ${PROXY}` });

let oversized = 0;
let serverGaps = 0;
let servers = [];
let patterns = null;
let configs = 0;
let snippets = 0;

if (!problems.length) {
  patterns = matcherPatterns(fs.readFileSync(PROXY, 'utf8'));
  if (!patterns) {
    problems.push({ what: `у ${PROXY} не знайдено matcher — гейт не знає, що виключено` });
  }

  for (const entry of fs.readdirSync(NGINX_DIR).sort()) {
    if (!entry.endsWith('.conf')) continue;
    const file = `${NGINX_DIR}/${entry}`;
    const text = fs.readFileSync(file, 'utf8');
    const found = parseNginx(text);

    if (found.length) {
      // Файл оголошує серверні блоки — тут стеля на своєму місці, і нижче
      // вона звіряється з matcher по кожному `location`.
      configs++;
      for (const srv of found) servers.push({ ...srv, file });
      continue;
    }

    // ── Сніпет: стеля тут ЗАБОРОНЕНА ───────────────────────────────────────
    //
    // Не тому, що nginx її не дозволяє (дозволяє), а тому, що сніпет
    // інклюдиться в кілька блоків одночасно: стеля, оголошена тут, мовчки
    // накриває кожен `location`, який його включив, і жоден із них цього не
    // каже. Стеля належить блокові, який її декларує, — тоді її видно поруч
    // зі шляхом, для якого вона зроблена, і `matcher` можна з нею звірити.
    snippets++;
    const clean = stripComments(text);
    for (const m of clean.matchAll(/client_max_body_size\s+([^;]+);/g)) {
      const line = clean.slice(0, m.index).split('\n').length;
      problems.push({
        what: `${file}:${line}: \`client_max_body_size ${m[1].trim()}\` у СНІПЕТІ`,
        fix:
          'сніпет інклюдиться в кілька блоків — стеля з нього накриває кожен із них мовчки.\n' +
          '      Оголосіть її в тому `location`, для якого вона зроблена: там її видно поруч\n' +
          '      зі шляхом, і саме там її звіряють із matcher у src/proxy.ts.',
      });
    }
  }

  if (!servers.length && !problems.length) {
    problems.push({ what: `у ${NGINX_DIR} не знайдено жодного серверного блоку — гейт нічого не стереже` });
  }
}

if (patterns && servers.length) {
  const matches = (pathname) =>
    patterns.some((p) => {
      let re;
      try {
        re = new RegExp(`^(?:${p})$`);
      } catch {
        return true; // нечитний візерунок — вважаємо, що ловить: краще хибний ✗, ніж тиша
      }
      return re.test(pathname);
    });

  for (const server of servers) {
    const name = server.serverName || '(без server_name)';
    // Лише TLS-блоки цікаві: 80-й порт тут або перенаправляє, або віддає виклик.
    const root = server.locations.find((l) => l.path === '/' && !l.op);
    const rootPort = root?.proxyPass ? /:(\d+)/.exec(root.proxyPass)?.[1] : null;

    // Храповик на серверну стелю — пояснення біля SERVER_DEFAULT_ACK.
    if (server.bodyLimit && server.bodyLimit > NEXT_BODY_LIMIT) {
      serverGaps++;
      if (server.bodyLimit !== parseSize(SERVER_DEFAULT_ACK)) {
        problems.push({
          what:
            `${server.file}: server ${name} → client_max_body_size на рівні блоку — ` +
            `${Math.round(server.bodyLimit / 1024 / 1024)} МБ, зафіксовано ${SERVER_DEFAULT_ACK}`,
          fix:
            'серверна стеля вища за буфер middleware (10 МБ) — між ними вікно тихого\n' +
            '      обрізання для КОЖНОГО маршруту. Підняти її можна, але не мовчки:\n' +
            `      допишіть нове число в SERVER_DEFAULT_ACK у ${'scripts/check-body-limits.mjs'}\n` +
            '      і скажіть у docs/ARCHITECTURE.md, наскільки розширили вікно.',
        });
      }
    }

    for (const loc of server.locations) {
      // Лише ВЛАСНА стеля location: це названий виняток для одного шляху, і
      // саме він мусить узгоджуватись із matcher. Успадкована стеля блоку —
      // інше питання, і воно вище, під храповиком.
      const limit = loc.bodyLimit;
      if (!limit || limit <= NEXT_BODY_LIMIT) continue;
      oversized++;

      const where = `${server.file}: server ${name} → location ${loc.op ? loc.op + ' ' : ''}${loc.path}`;

      if (matches(loc.path)) {
        problems.push({
          what: `${where}\n      тіло до ${Math.round(limit / 1024 / 1024)} МБ, а ${PROXY} пускає цей шлях через middleware`,
          fix:
            `додайте \`${loc.path.replace(/^\//, '')}\` у заперечний перегляд matcher у ${PROXY}.\n` +
            '      Next буферизує тіло під middleware зі стелею 10 МБ і МОВЧКИ обриває його:\n' +
            '      маршрут дістає початок файла, sha256 не сходиться, у лог іде попередження.',
        });
      }

      if (!loc.proxyPass) {
        problems.push({
          what: `${where}\n      немає власного proxy_pass`,
          fix: 'location без proxy_pass не успадковує його — запит піде в 404 замість застосунку',
        });
        continue;
      }
      const port = /:(\d+)/.exec(loc.proxyPass)?.[1];
      if (rootPort && port !== rootPort) {
        problems.push({
          what: `${where}\n      proxy_pass на порт ${port}, а \`location /\` того ж блоку — на ${rootPort}`,
          fix:
            'порт береться з того самого серверного блоку. Прод слухає 3130, бета 3131,\n' +
            '      і блок, скопійований разом із портом, віддав би знімок бети продові — мовчки.',
        });
      }
    }
  }
}

console.log('check-body-limits');
if (problems.length === 0) {
  console.log(
    `  чисто — ${configs} конфіг(и) і ${snippets} сніпет(и) у ${NGINX_DIR}: ` +
    `${servers.length} серверних блоків, ${oversized} location зі стелею понад 10 МБ;`,
  );
  console.log('  усі виключені з middleware і проксюють на порт свого середовища');
  if (serverGaps) {
    console.log('');
    console.log(`  примітка: серверна стеля ${SERVER_DEFAULT_ACK} у ${serverGaps} блоках теж вища за`);
    console.log('  буфер middleware — вікно тихого обрізання 10…25 МБ для решти маршрутів.');
    console.log('  Відкрита річ, тримається храповиком; docs/ARCHITECTURE.md → «Лишається».');
  }
  process.exit(0);
}

for (const p of problems) {
  console.log(`  ✗ ${p.what}`);
  if (p.fix) console.log(`      → ${p.fix}`);
}
console.log(`\n  ${problems.length} — дві стелі на одному шляху, і нижча мовчить.`);
process.exit(strict ? 1 : 0);
