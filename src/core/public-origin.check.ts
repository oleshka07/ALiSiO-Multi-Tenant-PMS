/**
 * Адреса, надрукована на папері, веде НА ЦЕЙ сервер.
 *
 *   node src/core/public-origin.check.ts
 *
 * Гейт заведено після того, як це вже надрукували: перший аркуш A4 для
 * Ґрайца вийшов із `https://0.0.0.0:3000/stay/avstta7hamqxcpva` — і в
 * підписі, і в QR. Виглядає бездоганно, не працює ні в кого.
 *
 * ── Чому попередній гейт цього не бачив ─────────────────────────────────
 *
 * `a4-sheet.check` приймає `origin` АРГУМЕНТОМ і передає йому правильний
 * рядок. Тобто він стверджував «код веде туди, куди підпис» — і це була
 * правда: обидва вели на `0.0.0.0`. Твердження було про рівність двох
 * значень, а не про те, звідки взялося саме значення. §3.2.1 дослівно:
 * стерегли ВЛАСТИВІСТЬ аркуша й не стерегли властивості ДЖЕРЕЛА.
 *
 * Тому тут осі інші: не «однакові», а «звідки».
 */
import assert from 'node:assert';
import '../../scripts/lib/module-aliases.mjs';

const { publicOrigin } = await import('./public-origin.ts');

let ok = 0;
const say = (what: string) => { console.log(`  ok  ${what}`); ok += 1; };

/** Мінімальний набір заголовків — рівно те, чим користується код. */
const bag = (h: Record<string, string>) => ({
  get: (name: string) => h[name.toLowerCase()] ?? null,
});

const savedAppUrl = process.env.APP_URL;
const savedLegacy = process.env.NEXT_PUBLIC_APP_URL;
delete process.env.APP_URL;
delete process.env.NEXT_PUBLIC_APP_URL;

try {
  // ── 1. ТОЙ САМИЙ випадок, що надрукували ──────────────────────────────
  //
  // Прод-образ: Next слухає 0.0.0.0:3000, nginx каже справжнє імʼя. Раніше
  // код читав `request.url` — тобто перше. Фікстура несе ОБИДВА значення,
  // і вони РІЗНІ: з однаковими злам «читати сокет» лишився б зеленим.
  const behindProxy = bag({
    host: '0.0.0.0:3000',
    'x-forwarded-host': 'beta.alisio.rozum.one',
    'x-forwarded-proto': 'https',
  });
  assert.strictEqual(publicOrigin(behindProxy), 'https://beta.alisio.rozum.one',
    'за проксі адреса береться з x-forwarded-*, не з сокета');
  say('за nginx: 0.0.0.0:3000 у `host`, а на папері — beta.alisio.rozum.one');

  // ── 2. Адреса прив'язки НЕ стає відповіддю ────────────────────────────
  //
  // Проксі мовчить, лишився тільки сокет. Відмова, не вигадка: інваріант 13
  // і 17 разом — надрукований аркуш із мертвою адресою гірший за ненадрукований.
  for (const dead of ['0.0.0.0:3000', '0.0.0.0', '[::]:3000', '::']) {
    assert.strictEqual(publicOrigin(bag({ host: dead })), null,
      `«${dead}» — адреса прив'язки, вона не має ставати адресою на папері`);
  }
  assert.strictEqual(publicOrigin(bag({})), null, 'жодного заголовка — теж null');
  say("адреса прив'язки й порожнеча дають null, а не рядок для друку");

  // ── 3. Налаштоване важить більше за проксі ────────────────────────────
  //
  // `APP_URL` їде у вебхуки каналу й у листи. Аркуш, який каже інше, —
  // друга відповідь на те саме питання (клас запасного 'CZK').
  process.env.APP_URL = 'https://alisio.swipescape.eu/';
  assert.strictEqual(publicOrigin(behindProxy), 'https://alisio.swipescape.eu',
    'налаштована адреса виграє в заголовків, і скісна з кінця зникає');
  // І ЇЇ теж звіряємо: мертву адресу можна вписати в env-файл руками.
  process.env.APP_URL = 'http://0.0.0.0:3000';
  assert.strictEqual(publicOrigin(behindProxy), 'https://beta.alisio.rozum.one',
    'мертва APP_URL не приймається — беремо те, що сказав проксі');
  delete process.env.APP_URL;
  say('APP_URL виграє в заголовків, але мертва APP_URL не виграє ні в чому');

  // ── 4. Порт лишається ─────────────────────────────────────────────────
  //
  // Бета живе на своєму порту. Відрізати його «для краси» означає послати
  // гостя на 80-й, де стоїть інший сайт того самого сервера.
  assert.strictEqual(publicOrigin(bag({ host: 'localhost:3131' })), 'http://localhost:3131',
    'порт значущий — його не можна губити');
  assert.strictEqual(publicOrigin(bag({ host: 'pms.example' })), 'https://pms.example',
    'імʼя без порту — https за замовчуванням');
  say('порт зберігається; localhost — http, іменований хост — https');

  // ── 5. Список із кількох значень ──────────────────────────────────────
  //
  // Два проксі поспіль дають `a, b`. Перший — той, до кого прийшов гість.
  assert.strictEqual(
    publicOrigin(bag({ 'x-forwarded-host': 'beta.alisio.rozum.one, inner', 'x-forwarded-proto': 'https, http' })),
    'https://beta.alisio.rozum.one',
    'із ланцюжка проксі береться ПЕРШИЙ — той, кого бачив гість');
  say('ланцюжок проксі: береться перший запис, не останній');
} finally {
  if (savedAppUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = savedAppUrl;
  if (savedLegacy === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = savedLegacy;
}

console.log(`public-origin: адреса на папері — не адреса сокета, ${ok} тверджень`);
