/**
 * Файл готелю, який зламається аж на бойовому сервері.
 *
 *   node scripts/check-hotels.mjs
 *
 * `hotels/*.json` накочуються деплоєм автоматично, тобто помилка в них — це
 * помилка на проді, а не на екрані того, хто її зробив. Друкарська помилка в
 * `unitType`, ціна рядком замість числа, два типи з однаковим кодом, розділ
 * `acceptance`, якого нема, — усе це виявляється тут, за секунду, і жодне з
 * цього не доїжджає до готелю.
 *
 * Найважливіша перевірка — остання: файл БЕЗ приймальних перевірок не
 * пропускається. Заведення без них означає «рядки лягли», а чи продає готель
 * за тими цінами, які назвав, ніхто не питав. Саме там і живуть помилки в
 * ціноутворенні: не в тому, що рядок не записався, а в тому, що записався не
 * той.
 *
 * Що тут НЕ перевіряється: чи правильні самі числа. Цього не знає ніхто, крім
 * готелю, і вигадувати за нього — гірше, ніж не перевіряти.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DIR = 'hotels';
const problems = [];
const note = (file, what) => problems.push(`${file}: ${what}`);

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  : [];

const TEMPLATE = (f) => f.startsWith('_') || f.startsWith('.');
const CODE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAX_CODES = ['standard', 'reduced', 'zero'];
const SERVICE_CATEGORIES = ['food', 'wellness', 'sport', 'entertainment', 'other'];

/** Читати обидва правописи, точно як це робить apply-hotel.mjs. */
const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
function f(obj, ...names) {
  for (const n of [...names, ...names.map(snake)]) {
    if (obj?.[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return undefined;
}
const num = (v) => (v === undefined ? undefined : Number(v));
const isNum = (v) => v !== undefined && Number.isFinite(Number(v));

for (const name of files) {
  const file = path.join(DIR, name);
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    note(file, `не читається як JSON — ${e.message}`);
    continue;
  }

  const template = TEMPLATE(name);

  // ── організація ───────────────────────────────────────────────────────────
  const org = plan.organization || {};
  const slug = f(org, 'slug');
  if (!slug) note(file, 'organization.slug відсутній — це ключ, за яким готель упізнається');
  else if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) {
    note(file, `organization.slug "${slug}" — лише малі літери, цифри й дефіси`);
  }
  if (!f(org, 'ownerEmail')) note(file, 'organization.ownerEmail відсутній — без нього готель не створиться');
  // Пароль у файлі поїхав би в git і лишився б в історії назавжди.
  for (const key of ['ownerPassword', 'owner_password', 'password']) {
    if (org[key]) note(file, `organization.${key} — пароль не кладуть у репозиторій; він генерується при створенні`);
  }

  // ── ставки ────────────────────────────────────────────────────────────────
  for (const t of plan.taxRates || plan.tax_rates || []) {
    const code = f(t, 'code');
    if (!TAX_CODES.includes(code)) note(file, `ставка "${code}" — має бути ${TAX_CODES.join(', ')}`);
    const rate = num(f(t, 'rate'));
    if (!isNum(rate) || rate < 0 || rate > 100) note(file, `ставка ${code}: rate "${f(t, 'rate')}" не відсоток 0…100`);
    const from = f(t, 'validFrom');
    if (from && !DATE.test(from)) note(file, `ставка ${code}: validFrom "${from}" не YYYY-MM-DD`);
  }

  // ── серії ─────────────────────────────────────────────────────────────────
  for (const s of plan.invoiceSeries || plan.invoice_series || []) {
    const code = f(s, 'code');
    if (!code || !/^[A-Za-z0-9_-]{1,16}$/.test(code)) note(file, `серія "${code}" — 1–16 символів A–Z 0–9 _ -`);
    const format = f(s, 'numberFormat') || '{prefix}{seq:4}';
    // Шаблон без лічильника видавав би один і той самий номер вічно.
    if (!/\{seq(?::\d+)?\}/.test(format)) note(file, `серія ${code}: numberFormat без {seq} — усі фактури дістануть один номер`);
    // Токен усередині префікса не розгортається: formatInvoiceNumber підставляє
    // {prefix} дослівно за один прохід, і «RE{year}-» надрукувався б на фактурі
    // як є. Рік належить шаблону: prefix "RE", numberFormat "{prefix}{year}-{seq:4}".
    const prefix = f(s, 'prefix');
    if (prefix && /[{}]/.test(prefix)) {
      note(file, `серія ${code}: prefix "${prefix}" містить {…} — токени працюють лише в numberFormat, на фактурі це надрукується дослівно`);
    }
  }

  // ── типи номерів ──────────────────────────────────────────────────────────
  const typeCodes = new Set();
  const categoryNames = new Set((plan.categories || []).map((c) => f(c, 'name')));
  const buildingNames = new Set((plan.buildings || []).map((b) => f(b, 'name')));

  for (const t of plan.unitTypes || plan.unit_types || []) {
    const code = f(t, 'code');
    if (!code || !CODE.test(code)) { note(file, `тип номера "${code}" — порожній або з дивними символами`); continue; }
    if (typeCodes.has(code)) note(file, `тип номера ${code} описано двічі — другий опис мовчки виграє`);
    typeCodes.add(code);

    const cat = f(t, 'category');
    if (cat && !categoryNames.has(cat)) note(file, `тип ${code}: категорії "${cat}" немає в categories`);
    const bld = f(t, 'building');
    if (bld && !buildingNames.has(bld)) note(file, `тип ${code}: будівлі "${bld}" немає в buildings`);

    const windows = new Set();
    for (const p of f(t, 'occupancyPrices') || t.prices || []) {
      const persons = num(f(p, 'persons'));
      const price = num(f(p, 'priceGross', 'price'));
      if (!Number.isInteger(persons) || persons < 1) note(file, `тип ${code}: persons "${f(p, 'persons')}" не ціле від 1`);
      if (!isNum(price) || price < 0) note(file, `тип ${code} ×${persons}: priceGross "${f(p, 'priceGross', 'price')}" не число`);
      const from = f(p, 'validFrom') ?? null;
      const to = f(p, 'validTo') ?? null;
      for (const [d, n] of [[from, 'validFrom'], [to, 'validTo']]) {
        if (d && !DATE.test(d)) note(file, `тип ${code} ×${persons}: ${n} "${d}" не YYYY-MM-DD`);
      }
      if (from && to && to < from) note(file, `тип ${code} ×${persons}: validTo раніше за validFrom`);
      // Два рядки з однаковим ключем — один із них ніколи не застосується.
      const key = `${persons}|${from}|${to}`;
      if (windows.has(key)) note(file, `тип ${code} ×${persons} ${from}…${to} — два рядки на одне вікно`);
      windows.add(key);
    }

    const tiers = new Set();
    for (const l of f(t, 'losTiers') || t.los || []) {
      const min = num(f(l, 'minNights'));
      const adj = num(f(l, 'adjustmentGross', 'adjustment'));
      if (!Number.isInteger(min) || min < 2) note(file, `тип ${code}: minNights "${f(l, 'minNights')}" має бути ціле від 2`);
      if (!isNum(adj)) note(file, `тип ${code}: adjustmentGross "${f(l, 'adjustmentGross', 'adjustment')}" не число`);
      const key = `${min}|${f(l, 'persons') ?? '*'}`;
      if (tiers.has(key)) note(file, `тип ${code}: два LOS-правила від ${min} ночей на ту саму заселеність`);
      tiers.add(key);
    }
  }

  // ── номери ────────────────────────────────────────────────────────────────
  for (const u of plan.units || []) {
    const typeCode = f(u, 'unitType', 'unitTypeCode');
    if (!typeCodes.has(typeCode)) { note(file, `номери типу "${typeCode}" — такого типу у файлі нема`); continue; }
    const from = f(u, 'from');
    if (from !== undefined) {
      const to = f(u, 'to');
      if (!Number.isInteger(num(from)) || !Number.isInteger(num(to))) {
        note(file, `діапазон ${typeCode}: from/to мають бути цілими`);
      } else if (num(to) < num(from)) {
        note(file, `діапазон ${typeCode}: to (${to}) менше за from (${from}) — жодного номера не створиться`);
      } else if (num(to) - num(from) > 500) {
        note(file, `діапазон ${typeCode}: ${num(to) - num(from) + 1} номерів — схоже на друкарську помилку`);
      }
    } else if (!f(u, 'code', 'name')) {
      note(file, `номер типу ${typeCode}: ні from/to, ні code — нічого створювати`);
    }
  }

  // ── правила каналів ───────────────────────────────────────────────────────
  const channels = new Set();
  for (const c of plan.channelRules || plan.channel_rules || []) {
    const ch = (f(c, 'channel') || '').toString().trim().toLowerCase();
    if (channels.has(ch)) note(file, `правило каналу "${ch || '(за замовчуванням)'}" описано двічі`);
    channels.add(ch);
    const markup = num(f(c, 'markupPercent')) ?? 0;
    // Нижче −100 % канал доплачував би готелю за право продавати.
    if (!isNum(markup) || markup < -100 || markup > 900) note(file, `канал "${ch}": markupPercent ${markup} поза −100…900`);
    for (const key of ['lodgingTaxCode', 'foodTaxCode', 'drinksTaxCode']) {
      const v = f(c, key);
      if (v && !TAX_CODES.includes(v)) note(file, `канал "${ch}": ${key} "${v}" — має бути ${TAX_CODES.join(', ')}`);
    }
  }

  // ── послуги ───────────────────────────────────────────────────────────────
  for (const s of plan.services || []) {
    const name = f(s, 'name');
    const vat = f(s, 'vatCode');
    // Міграція 0017: послуга без коду ПДВ зупиняє ВСЮ проводку рахунку.
    if (!vat) note(file, `послуга "${name}" без vatCode — вона зупинить проводку всього рахунку`);
    else if (!TAX_CODES.includes(vat)) note(file, `послуга "${name}": vatCode "${vat}" — має бути ${TAX_CODES.join(', ')}`);
    const cat = f(s, 'category');
    if (cat && !SERVICE_CATEGORIES.includes(cat)) {
      note(file, `послуга "${name}": category "${cat}" — має бути ${SERVICE_CATEGORIES.join(', ')}`);
    }
    if (!isNum(num(f(s, 'price')) ?? 0)) note(file, `послуга "${name}": price не число`);
  }

  // ── збори й мито ──────────────────────────────────────────────────────────
  //
  // Тип під CHECK-обмеженням схеми: хибний не вставиться, і про це стане
  // відомо посеред застосування файлу на сервері. Тут — до того, як хтось
  // натисне деплой.
  //
  // Нуль перевіряється окремо: збір із amount 0 вставиться без заперечень і
  // просто ніколи не потрапить у квоту, бо розрахунок відкидає нульові рядки.
  // Тобто це рядок, що має вигляд налаштованого мита й нічого не робить.
  const FEE_TYPES = ['per_stay', 'per_night', 'per_person', 'per_person_per_night', 'percentage'];
  for (const fee of plan.fees || plan.feesTaxes || plan.fees_taxes || []) {
    const name = f(fee, 'name');
    if (!name) { note(file, 'збір без назви — у квоті гість побачить порожній рядок'); continue; }
    const type = f(fee, 'type');
    if (!FEE_TYPES.includes(type)) {
      note(file, `збір "${name}": type "${type || '—'}" — має бути ${FEE_TYPES.join(', ')}`);
    }
    const amount = num(f(fee, 'amount'));
    if (!isNum(amount ?? 0)) note(file, `збір "${name}": amount не число`);
    else if ((amount ?? 0) <= 0) {
      note(file, `збір "${name}": amount ${amount} — нульовий збір не потрапляє в квоту взагалі`);
    }
  }

  // ── джерела бронювань ─────────────────────────────────────────────────────
  //
  // Прямо / телефон / пошта / з вулиці засіває provisionOrganization мовою
  // готелю; тут готель називає МАЙДАНЧИКИ, на яких справді продає. Комісія не
  // косметика: вона йде в розрахунок нетто по каналу, тож помилка в ній
  // видно не одразу, а у звіті за місяць.
  const seenCodes = new Set();
  for (const src of plan.bookingSources || plan.booking_sources || []) {
    const code = f(src, 'code');
    const name = f(src, 'name') || code;
    if (!code) { note(file, 'джерело без code — код це те, чим бронь на нього посилається'); continue; }
    if (seenCodes.has(code)) note(file, `джерело "${code}" названо двічі — застосується останнє`);
    seenCodes.add(code);
    const commission = num(f(src, 'commissionPercent'));
    if (commission != null && !isNum(commission)) {
      note(file, `джерело "${name}": commissionPercent не число`);
    } else if (commission != null && (commission < 0 || commission > 100)) {
      note(file, `джерело "${name}": комісія ${commission}% поза 0–100`);
    }
  }

  // ── гостьова сторінка ─────────────────────────────────────────────────────
  // Три поля зберігаються як JSON і читаються сторінкою через parseJSON з
  // фолбеком: помилкова форма не падає, вона просто НІЧОГО не показує гостю.
  // Тому форму перевіряємо тут, а не чекаємо, поки хтось помітить порожній
  // розділ на телефоні гостя.
  const gp = plan.guestPage || plan.guest_page;
  if (gp) {
    const shapes = {
      faqItems: ['q', 'a'],
      usefulInfo: ['icon', 'title', 'desc'],
      rules: ['icon', 'text'],
    };
    for (const [key, keys] of Object.entries(shapes)) {
      const val = f(gp, key, snake(key));
      if (val === undefined) continue;
      if (!Array.isArray(val)) { note(file, `гостьова сторінка: ${key} має бути масивом`); continue; }
      val.forEach((item, i) => {
        if (!item || typeof item !== 'object') {
          note(file, `гостьова сторінка: ${key}[${i}] — не обʼєкт`);
          return;
        }
        for (const k of keys) {
          if (!item[k]) note(file, `гостьова сторінка: ${key}[${i}] без "${k}" — розділ покажеться порожнім`);
        }
      });
    }
    const phone = f(gp, 'emergencyPhone', 'emergency_phone');
    if (phone !== undefined && !String(phone).trim()) {
      note(file, 'гостьова сторінка: emergencyPhone порожній — краще не називати поле взагалі');
    }
  }

  // ── зали ──────────────────────────────────────────────────────────────────
  // Ставка зали живе на самій залі (міграція 0025). Помилка в коді ПДВ не
  // видна ніде, поки рецепція не спробує виставити рахунок за подію — і тоді
  // проводка падає з «No tax rate», уже перед гостем.
  const spaceCodes = new Set();
  for (const sp of plan.eventSpaces || plan.event_spaces || []) {
    const code = f(sp, 'code');
    if (!code) { note(file, 'зала без code — її нічим упізнати при повторному прикладанні'); continue; }
    if (spaceCodes.has(code)) note(file, `зала "${code}" описана двічі`);
    spaceCodes.add(code);
    const vat = f(sp, 'vatCode');
    if (vat && !TAX_CODES.includes(vat)) {
      note(file, `зала "${code}": vatCode "${vat}" — має бути ${TAX_CODES.join(', ')}`);
    }
  }
  for (const a of plan.eventAddons || plan.event_addons || []) {
    const vat = f(a, 'vatCode');
    if (vat && !TAX_CODES.includes(vat)) {
      note(file, `доплата "${f(a, 'name')}": vatCode "${vat}" — має бути ${TAX_CODES.join(', ')}`);
    }
  }

  // ── приймальні перевірки ──────────────────────────────────────────────────
  const checks = plan.acceptance || plan.quotes || [];
  if (!template && checks.length === 0 && typeCodes.size > 0) {
    note(file, 'нема жодної приймальної перевірки — тоді ніхто не питав, чи готель продає за тими цінами, які назвав');
  }
  for (const q of checks) {
    const typeCode = f(q, 'unitType', 'unitTypeCode');
    if (!typeCodes.has(typeCode)) note(file, `перевірка на тип "${typeCode}" — такого типу у файлі нема`);
    const checkIn = f(q, 'checkIn');
    if (!checkIn || !DATE.test(checkIn)) note(file, `перевірка ${typeCode}: checkIn "${checkIn}" не YYYY-MM-DD`);
    const checkOut = f(q, 'checkOut');
    if (checkOut && !DATE.test(checkOut)) note(file, `перевірка ${typeCode}: checkOut "${checkOut}" не YYYY-MM-DD`);
    if (!checkOut && !isNum(f(q, 'nights'))) note(file, `перевірка ${typeCode}: ні checkOut, ні nights`);
    if (!isNum(f(q, 'expectTotal', 'expect'))) note(file, `перевірка ${typeCode}: expectTotal не число`);
    const persons = num(f(q, 'persons'));
    if (!Number.isInteger(persons) || persons < 1) note(file, `перевірка ${typeCode}: persons "${f(q, 'persons')}" не ціле від 1`);
  }
}

/**
 * І остання перевірка: чи накочувач взагалі запускається так, як його
 * запускає сервер.
 *
 * Усе вище читає файли. Це — виконує скрипт: голий `node`, без прапорців,
 * проти порожньої бази у тимчасовій теці. Саме цього бракувало, і саме тому
 * перший прогін на проді впав на `Cannot find package '@core/db'`: локально
 * скрипт щоразу запускали з окремим завантажувачем аліасів, якого в
 * контейнері немає, тож перевіряли все, крім єдиної відмінності.
 *
 * Суха, тому нічого не пише; але імпорти, аліаси й розбір файла — справжні.
 */
function starts() {
  if (problems.length > 0) return;                       // спершу полагодьте файли
  if (files.every(TEMPLATE)) return;                     // нема чого накочувати

  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hotels-smoke-'));
  try {
    const run = spawnSync(process.execPath, ['scripts/apply-hotel.mjs', '--all', '--dry-run'], {
      encoding: 'utf8',
      // Порожній DB_DRIVER — SQLite у тимчасовій теці. Ніщо не торкається
      // ні бази розробника, ні тим паче сервера.
      env: { ...process.env, ALISIO_DATA_DIR: data, DB_DRIVER: '' },
    });
    if (run.status !== 0) {
      const why = `${run.stderr || ''}${run.stdout || ''}`.trim().split('\n')
        .filter((l) => !l.startsWith('[DB]') && !l.startsWith('[Seed]') && l.trim())
        .slice(0, 6).join('\n      ');
      note('scripts/apply-hotel.mjs', `не запускається під голим node (код ${run.status}):\n      ${why}`);
    }
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
}
starts();

console.log('═'.repeat(78));
console.log('ФАЙЛИ ГОТЕЛІВ, ЯКІ ЗЛАМАЮТЬСЯ НА СЕРВЕРІ — має бути нуль');
console.log('═'.repeat(78));
console.log();

if (problems.length === 0) {
  const real = files.filter((f) => !TEMPLATE(f));
  console.log(real.length === 0
    ? '  готелів у hotels/ ще нема — перевіряти нічого'
    : `  чисто — ${real.length} готел${real.length === 1 ? 'ь' : 'ів'} (+${files.length - real.length} шаблон)`);
  for (const name of real) console.log(`    ${name}`);
  process.exit(0);
}

for (const p of problems) console.log(`  ${p}`);
console.log(`\n  ${problems.length} — деплой прикладає ці файли сам, тому це помилки на проді.`);
process.exit(1);
