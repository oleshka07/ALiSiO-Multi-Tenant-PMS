/**
 * Is anybody's business written into the source?
 *
 *   node scripts/check-no-tenant-names.mjs
 *
 * The first customer's name, domain, company and category vocabulary were
 * spread across 188 places: payment routing keyed on two literal site ids,
 * CORS allowlists naming one staging host, invoices printing one company's
 * IČO and bank account, guests welcomed to a Czech campsite by every hotel.
 *
 * Each one is invisible until a second customer hits it, and by then it is
 * their invoice or their guest's card statement. So it is a build check, not
 * a code review item. A name that has to stay (a legal document, a historical
 * comment) goes in ALLOWED with the reason.
 *
 * `hotels/` is NOT walked, and that is deliberate rather than an oversight.
 * The rule is about CODE: a hotel's name reaching a second hotel's screen
 * because someone typed it into a component. `hotels/*.json` is the one place
 * where a customer's business is allowed to be a file — it is read at runtime
 * by scripts/apply-hotel.mjs and never imported, so nothing in the product can
 * depend on what is in it. Adding this directory to the walk would flag the
 * pilot's own room numbers as a violation and leave nowhere to put them.
 */
import fs from 'node:fs';
import path from 'node:path';

// Names, domains and vocabulary belonging to one customer rather than the product.
const FORBIDDEN = [
  /kemp[\s-]?carlsbad/i,
  /kempcarlsbad/i,
  /kemptimebot/i,
  /qa[\s-]glamping/i,
  /quiet\s+anomaly/i,
  /onrender\.com/i,
  // A person's name in a letter the product sends. The booking confirmation
  // was signed "Oleg Stepeniev 🌿" and described "a hot tub under the stars" —
  // every hotel's guest received it, whoever they had actually booked with.
  // The hotel's own voice belongs in widget_config.email_confirmed_body.
  /Stepeniev/i,
  /Степен[ії]єв/i,
  // The first customer's guest-page SECRETS, shipped as column DEFAULTS: every
  // new database was born with their real door code, their wifi password and
  // a Google-Maps pin on their driveway. A default is code, and these were
  // one customer's keys written into it.
  /4971#/,
  /ALiSiO2026/i,
  /WH2CKhTydtDx9EBe7/,
  /ALiSiO_Guest\b/i,
  /Ресторан ALiSiO/i,
  // The first customer's PLACE, written into "default" guest-page content:
  // their town, the GPS pin of their driveway, their building F. Seeded for
  // every unit type of every hotel until 2026-08-21.
  /Лугачовіце/i,
  /Luhačovice/i,
  /49\.1122/,
  /Будови F/i,
  // The first customer's real reception phone, hardcoded into guest screens:
  // every hotel's guests were invited to dial it.
  /773.?708.?849/,
  // The pilot's WhatsApp number, and its street. Both were in the guest page:
  // the number as `const WHATSAPP_NUMBER`, wired to the most prominent button
  // on the screen, and the street as `footerLocation` — TRANSLATED INTO SEVEN
  // LANGUAGES, which is how one customer's address became every hotel's
  // footer. Being translated is what hid it: the dictionary looked like
  // product copy. Both now come from the property, and this gate is the reason
  // they cannot come back.
  /420.?723.?565.?616/,
  /Loketsk[áa]/i,
  /Karlovy\s+Vary/i,
  /Карлові\s+Вари/i,
  /Radošov/i,

];

/*
 * ─── Клас сліпоти, знайдений 2026-08-28 ─────────────────────────────────
 *
 * Усе вище — ІМЕНА: назва, домен, телефон, GPS, код дверей. Тобто «ХТО цей
 * клієнт». Гейт жодного разу не спитав «ЩО цей клієнт продає» — і рівно там
 * просидів найбільший шматок: `GIFT_CARD_TEMPLATES`, шість шаблонів
 * ваучерів із цінами й продуктами одного кемпінгу, у файлі платформи, які
 * бачив КОЖЕН готель, що відкриє екран пропозицій.
 *
 * Він приїхав тим самим мерджем 69cab8a, що й цей гейт: 921 файл, 171 тисяча
 * рядків. Гейт народився сліпим до сусіда по коміту, а далі шість проходів
 * «вичистити дані першого клієнта» шукали ІМЕНА і чесно рапортували «чисто».
 *
 * Тому нижче — маркери іншого роду: словник продуктів, суми і назви будов.
 * Вони ширші за імена й теоретично можуть зачепити чужий рядок; тому кожен
 * виняток іде в ALLOWED з причиною, а не пом'якшенням шаблону.

 *
 * ── Чому це ОКРЕМИЙ список ──────────────────────────────────────────────
 *
 * `FORBIDDEN` вище звіряється з УСІМ рядком, коментарі включно. Так і треба:
 * код дверей, телефон рецепції чи GPS-пін лишаються чужими даними, навіть
 * якщо хтось написав їх у поясненні.
 *
 * Цей список звіряється з рядком БЕЗ коментарів. Інакше правило стало б «не
 * можна документувати те, що ти прибрав»: нотатка «тут стояли ціни одного
 * кемпінгу — глемпінг, сауна, чан» валила б збірку, і історію довелося б
 * стирати разом із кодом. А саме вона й пояснює наступному, чому так не
 * роблять.
 *
 * Те саме правило, що в AGENTS.md §4: перевірка, яка шукає щось у вихідному
 * коді, спершу вирізає коментарі.
 */
const FORBIDDEN_IN_CODE = [
  // ── Продукти й послуги одного кемпінгу ──
  //
  // Не «сауна» саму по собі — сауна є в багатьох готелів, і слово в загальному
  // списку зручностей це нормально. Ловиться ІМЕННО їхнє формулювання: назва
  // послуги з тривалістю, карпатський чан, глемпінг як категорія в коді.
  /Фінська\s+сауна/i,
  /Чан\s+карпатський/i,
  /карпатськ[аиой]+\s+чан/i,
  /глемпінг/i,
  /глэмпинг/i,

  // ── Маркетингова копія їхніх ваучерів ──
  //
  // Вона ще й ПЕРЕКЛАДЕНА на шість мов — той самий механізм, що сховав
  // `footerLocation` (див. вище): у словнику вона має вигляд продуктового
  // тексту. Ключі каталогу — теж код.
  /ПОДАРУЙ\s+ВІКЕНД/i,
  /БУДИНОЧОК\s+ДЛЯ\s+ДВОХ/i,
  /ЛІСОВИЙ\s+WORKCATION/i,
  /СОЛО-ВТЕЧА/i,
  /АКЦІЯ\s*1\+1\+1/i,
  /ДЕНЬ\s+НАРОДЖЕННЯ\s+НА\s+ПРИРОДІ/i,
  /Романтичний\s+вікенд/i,
  /Glamping\s+ALiSiO/i,

  // ── Будови ──
  //
  // `Будови F` вище ловило рівно одну форму. Корпусів у них два — F і D, — і
  // будь-яка інша відміна проходила повз.
  /будов[аиуоі]\w*\s+[FDФД]\b/i,

  // ── Вичищене 2026-08-28 разом із даними (чистка спадку) ──
  //
  // Ці формулювання жили в підказках операторського UI і в словнику
  // content-translations (він був винятком цього гейта — виняток знято, бо
  // підстави не стало). Маркери вузькі навмисно: «сауна» як слово належить
  // багатьом готелям, а «Купіль та сауна — за попереднім записом» — одному.
  /Оренда\s+кемпінгу/i,
  /сауна\s*\+\s*сніданок/i,
  /велосипеди,\s*чан/i,
  /Купіль\s+та\s+сауна/i,
  /Холодна\s+купіль/i,
  /Бухлов/i,
  /Buchlov/i,
  /Лешна/i,
  /Lešná/i,
  /будинок\s+[FD]\b/i,
  /\bbldg_[fd]\b/i,
  /\bu_f\d+\b/,

  // ── Їхні суми, у коді ──
  //
  // Найспірніший клас, і тому найвужчий: не «число 4900», а число ПОРУЧ ІЗ
  // грошовим полем. `face_value: 4900`, `price_czk: 8500`, `price = 600` для
  // сауни. Звичайний літерал 4900 у розрахунку сюди не потрапляє.
  /(face_value|price_czk|price_eur|original_price_eur|discount_eur|rate_standard)\s*[:=]\s*(4900|8500|580|725|190|220|145|95)\b/,
  /price\s*=\s*600,\s*unit_label/,
];

// Path → why the name is allowed to remain there.
const ALLOWED = new Map([
  ['src/modules/widget/data/site.repo.ts', 'documents the hardcodes it replaced'],
  ['scripts/check-no-tenant-names.mjs', 'this file lists them on purpose'],
  ['docs/SECURITY-FINDINGS.md', 'the findings record'],
  // The migration that REMOVES the leaked defaults has to name them in its
  // WHERE clauses — that is the one place they may remain.
  ['db/postgres/migrations/0023-a-default-is-code-and-these-were-somebodys-keys.sql', 'removes the leaked values it names'],
  // Та сама причина, з іншого боку: ця міграція ПЕРЕНОСИТЬ шаблони ваучерів із
  // коду в `gift_card_templates`, і щоб перенести — мусить назвати їх один
  // раз. Адресата вона при цьому не називає: рядки дістаються організаціям,
  // які вже видавали ваучери за цими шаблонами, тобто за даними, а не за
  // назвою готелю.
  ['db/postgres/migrations/0047-vouchers-belong-to-the-hotel-that-sells-them.sql', 'moves the templates it names out of code'],
  // Another detector, listing the same old names on purpose — same reason this
  // file is on the list.
  ['scripts/audit.mjs', 'lists old customer names to search for them'],
  // Translation keys ARE the first customer's stored content: the dictionary
  // translates what already sits in their rows, and the key must match those
  // bytes to do it. Removing the entry would break their live guest page.
]);

const files = [];
/**
 * `data` used to be in this skip list, to keep the local SQLite folder out.
 * The walk starts at `src`, where that folder does not exist — so all it
 * actually excluded was every module's own `data` folder: fifty-one files holding every
 * repository, every e-mail the product sends and every OTA payload. The
 * booking confirmation sat there signed with one person's name for months,
 * and this check reported "чисто" every time.
 *
 * A skip list matched on basename skips more than it was written for. The
 * local database is `/data` at the root and is unreachable from here.
 */
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx|mjs|json)$/.test(e.name)) continue;
    files.push(p.replace(/\\/g, '/'));
  }
})('src');
for (const extra of ['scripts', 'db']) {
  if (fs.existsSync(extra)) (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|mjs|sql)$/.test(e.name)) continue;
      files.push(p.replace(/\\/g, '/'));
    }
  })(extra);
}

/**
 * A row id from the seed, written into application code.
 *
 * The same failure as a name, with a quieter face. Two settings screens sent a
 * literal `prop_main_001` — the id of the FIRST customer's seed property — when
 * creating a room type or a room. For that hotel it worked. For every other
 * hotel the row does not exist, so the screen answered "Property not found",
 * and a new customer could not be set up without somebody editing code.
 *
 * Which property, which organization, which category — those are answers the
 * server derives from the session (`requirePropertyId`, `requireOrganizationId`),
 * never constants.
 *
 * Scoped to the application: db.ts and scripts/ legitimately write seed ids,
 * and are listed in SEED_OWNERS below.
 */
const SEED_ID = /['"`](?:prop|org|cat|ut|bldg|unit)_[a-z0-9]+_?\d{2,}['"`]/i;
const SEED_OWNERS = [/^src[\/\\]lib[\/\\]db\.ts$/, /^scripts[\/\\]/, /^db[\/\\]/];
const ownsSeedIds = (f) => SEED_OWNERS.some((re) => re.test(f));

const hits = [];
for (const f of files) {
  if (ALLOWED.has(f)) continue;
  // \r?\n, бо на Windows-копії git видає CRLF, а `.` у JS-регексі не матчить
  // `\r`: хвостовий `\r` не давав `/\/\/.*$/` нижче зрізати коментар, і гейт
  // оголошував хардкодом власне ДОЗВОЛЕНУ документацію прибраного.
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const seedAllowed = ownsSeedIds(f);
  lines.forEach((line, i) => {
    // A comment explaining a removed hardcode is not the hardcode.
    // `*` на початку — тіло блокового коментаря /** … */, яким у цьому проєкті
    // написана більшість пояснень.
    const code = /^\s*[*]/.test(line) ? '' : line.replace(/\/\/.*$/, '');
    // Імена, телефони, GPS, коди — по всьому рядку, коментарі включно.
    for (const re of FORBIDDEN) {
      if (re.test(line)) { hits.push({ f, n: i + 1, line: line.trim().slice(0, 100) }); return; }
    }
    // Словник, копія і суми — лише в КОДІ: пояснення того, що прибрали, це
    // документація, а не хардкод.
    for (const re of FORBIDDEN_IN_CODE) {
      if (re.test(code)) { hits.push({ f, n: i + 1, line: line.trim().slice(0, 100) }); return; }
    }
    if (!seedAllowed && SEED_ID.test(code)) {
      hits.push({ f, n: i + 1, line: line.trim().slice(0, 100) });
    }
  });
}

console.log('═'.repeat(78));
console.log("БІЗНЕС ОДНОГО КЛІЄНТА В КОДІ (імена, домени, seed-id) — має бути нуль");
console.log('═'.repeat(78));
console.log();

if (hits.length === 0) {
  console.log(`  чисто — ${files.length} файлів перевірено`);
  console.log();
  console.log('  Дозволені винятки:');
  for (const [f, why] of ALLOWED) console.log(`    ${f} — ${why}`);
  process.exit(0);
}

for (const h of hits) console.log(`  ${h.f}:${h.n}\n    ${h.line}`);
console.log();
console.log(`  ${hits.length} згадок. Дані клієнта живуть у базі, не у файлах.`);
process.exit(1);
