/**
 * Завести готель із файла — і завести його ще раз, нічого не зламавши.
 *
 *   node scripts/apply-hotel.mjs hotels/schlossberghotel.json
 *   node scripts/apply-hotel.mjs --all [--dry-run]
 *
 * Файл описує СТАН, до якого готель має прийти, а не список дій. Тому його
 * можна прикласти двічі, десять разів, і на беті й на проді: те, чого нема, —
 * створюється; те, що є і збігається, — не чіпається; те, що є й розійшлося, —
 * оновлюється. Не видаляється НІЧОГО. Прибрати рядок із файла — це не команда
 * стерти номер, у якому хтось живе.
 *
 * Навіщо саме так, а не скриптом по HTTP: щоб завести другий готель не треба
 * було нічого відкривати. Ні мережевої політики, ні SSH, ні пароля оператора,
 * ні доступу до адмінки. Новий готель — це новий файл у hotels/ і push.
 * Деплой сам його прикладе, бо він виконується там, де база вже під рукою.
 *
 * Що воно НЕ робить:
 *   — не видаляє й не деактивує нічого;
 *   — не чіпає жодного іншого орендаря: усе всередині runWithOrganization();
 *   — не вигадує чисел. Ціна, якої немає у файлі, не з'являється.
 *
 * Наприкінці — приймальні перевірки: файл сам каже, скільки має коштувати
 * кілька конкретних проживань, і прогін падає, якщо система рахує інакше.
 * Заведення без цього — це «рядки записались», а не «готель продає правильно».
 *
 * Дані клієнта лежать у hotels/*.json навмисно: правило AGENTS «жодної логіки
 * під готель X» — про КОД. Цей каталог і є те єдине місце, де бізнес клієнта
 * має право бути файлом, і він читається на льоту, ніколи не імпортується.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';

/**
 * `@core/…` і `@/…` для голого node.
 *
 * Модулі застосунку імпортують одне одного через аліаси з tsconfig. Це знає
 * бандлер і не знає node, а на сервері цей скрипт виконує саме node — без
 * Next, без webpack. Перший же прогін на проді впав на
 * `Cannot find package '@core/db'`, і впав він тому, що локально я щоразу
 * запускав скрипт із власним завантажувачем аліасів, якого в контейнері
 * немає. Тобто перевіряв усе, крім того єдиного, чим воно відрізняється.
 *
 * Тому резолвер тепер тут, у самому скрипті: як його запускають, так він і
 * перевіряється. Заразом добираються розширення — репозиторії імпортують
 * `./tenant-scope` без `.ts`, що node теж не вміє.
 *
 * Альтернатива — переписати всі звернення до БД сирим SQL і не залежати від
 * модулів. Це прибрало б проблему і разом з нею — єдине місце, де для кожної
 * таблиці написано INSERT.
 */
const ROOT = path.dirname(new URL('.', import.meta.url).pathname.replace(/\/$/, ''));
const ALIASES = (() => {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    return Object.entries(JSON.parse(raw).compilerOptions?.paths ?? {});
  } catch { return []; }
})();

function onDisk(candidate) {
  for (const p of [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.mjs`,
    `${candidate}.js`, path.join(candidate, 'index.ts')]) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function fromAlias(spec) {
  for (const [pattern, [target]] of ALIASES) {
    if (pattern.endsWith('/*')) {
      const head = pattern.slice(0, -1);
      if (spec.startsWith(head)) return path.join(ROOT, target.slice(0, -1) + spec.slice(head.length));
    } else if (spec === pattern) {
      return path.join(ROOT, target);
    }
  }
  return null;
}

registerHooks({
  resolve(spec, ctx, next) {
    const mapped = fromAlias(spec);
    if (mapped) {
      const file = onDisk(mapped);
      if (file) return { url: `file://${file}`, shortCircuit: true };
    }
    if (spec.startsWith('.') && ctx.parentURL?.startsWith('file://')) {
      const file = onDisk(path.resolve(path.dirname(ctx.parentURL.slice(7)), spec));
      if (file) return { url: `file://${file}`, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ALL = args.includes('--all');
const files = args.filter((a) => !a.startsWith('--'));

if (!ALL && files.length === 0) {
  console.error('usage: node scripts/apply-hotel.mjs <hotels/x.json> [--dry-run]');
  console.error('       node scripts/apply-hotel.mjs --all [--dry-run]');
  process.exit(2);
}

/**
 * `_щось.json` — шаблон, а не клієнт.
 *
 * Одна літера, бо альтернатива дорога: `_example.json` без цього правила
 * завела б організацію «Example Hotel» на бойовому сервері з першим же
 * деплоєм. Підкреслення означає «це зразок, не накочувати».
 */
const isTemplate = (name) => name.startsWith('_') || name.startsWith('.');

const targets = ALL
  ? (fs.existsSync('hotels')
      ? fs.readdirSync('hotels')
        .filter((f) => f.endsWith('.json') && !isTemplate(f))
        .sort().map((f) => path.join('hotels', f))
      : [])
  : files;

if (targets.length === 0) {
  console.log('готелів для накочування нема — hotels/ порожній');
  process.exit(0);
}

const { runWithOrganization } = await import('../src/core/auth/tenant-context.ts');
const { getSql } = await import('../src/core/db/async.ts');
const { provisionOrganization } = await import('../src/core/provisioning.ts');
const props = await import('../src/modules/properties/data/properties.repo.ts');
const cats = await import('../src/modules/properties/data/categories.repo.ts');
const builds = await import('../src/modules/properties/data/buildings.repo.ts');
const types = await import('../src/modules/properties/data/unit-types.repo.ts');
const units = await import('../src/modules/properties/data/units.repo.ts');
const pricing = await import('../src/modules/pricing/data/occupancy-price.repo.ts');
const { priceNights } = await import('../src/modules/pricing/data/nightly-price.ts');

/**
 * Читати і camelCase, і snake_case.
 *
 * Не з любові до обох, а тому що ці файли пишуть руками й переносять із
 * вивантажень адмінки. Впертися в один правопис означає, що готель заводиться
 * з третьої спроби через друкарську помилку в назві поля — і рівно це та
 * морока, заради усунення якої весь цей файл існує.
 */
function f(obj, ...names) {
  for (const n of names) {
    if (obj?.[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return undefined;
}
const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
/** camelCase-ім'я і його snake_case-двійник за один крок. */
const both = (obj, name) => f(obj, name, snake(name));

let failures = 0;
const say = {
  made: (what) => console.log(`  +  ${what}`),
  changed: (what) => console.log(`  ~  ${what}`),
  same: (what) => console.log(`  =  ${what}`),
  refused: (what, why) => { failures++; console.log(`  !  ${what} — ${why}`); },
};

for (const file of targets) {
  console.log(`\n${'─'.repeat(70)}\n${file}\n${'─'.repeat(70)}`);
  try {
    await applyOne(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    failures++;
    console.error(`  !  ${file} — ${e?.message || e}`);
  }
}

console.log(failures === 0
  ? '\nготелі відповідають файлам'
  : `\n${failures} розбіжностей — жодного рядка не видалено, але щось не зійшлося`);
process.exit(failures === 0 ? 0 : 1);

// ────────────────────────────────────────────────────────────────────────────

async function applyOne(plan) {
  const org = plan.organization || {};
  const slug = both(org, 'slug');
  if (!slug) throw new Error('organization.slug обовʼязковий — це ключ, за яким готель упізнається');

  const sql = getSql();
  let row = await sql.row('SELECT id, name FROM organizations WHERE slug = ?', [slug]);

  if (!row) {
    // Пароль друкується РАЗ і ніде не зберігається. Він у логу деплою, тому
    // перше, що робить власник, — міняє його. Класти пароль у файл у git було
    // б гірше в кожному вимірі.
    const password = crypto.randomBytes(18).toString('base64url').slice(0, 24);
    const email = both(org, 'ownerEmail');
    if (!email) throw new Error(`organization.ownerEmail потрібен, щоб створити ${slug}`);
    if (DRY) {
      console.log(`  [суха] створити організацію ${slug}`);
      return;
    }
    const made = await provisionOrganization({
      name: both(org, 'name') || slug,
      slug,
      ownerEmail: email,
      ownerPassword: password,
      ownerName: both(org, 'ownerName'),
      propertyName: both(plan.property || {}, 'name') || both(org, 'propertyName'),
      city: both(org, 'city'),
      country: both(org, 'country'),
      currency: both(org, 'currency'),
      timezone: both(org, 'timezone'),
      language: both(org, 'language'),
      enable: org.enable,
    });
    row = { id: made.organizationId, name: both(org, 'name') || slug };
    say.made(`організація ${slug}`);
    console.log(`\n     ВЛАСНИК: ${email}`);
    console.log(`     ПАРОЛЬ:  ${password}`);
    console.log('     Він друкується один раз і ніде не зберігається — змініть при першому вході.\n');
  } else {
    say.same(`організація ${slug}`);
  }

  await runWithOrganization(row.id, () => applyStructure(row.id, plan));
}

async function applyStructure(organizationId, plan) {
  const sql = getSql();

  // ── обʼєкт ────────────────────────────────────────────────────────────────
  const list = await props.listProperties(organizationId);
  const property = list[0];
  if (!property) throw new Error('в організації немає обʼєкта — це має був створити provisionOrganization');

  const wantProp = plan.property || {};
  const propPatch = {};
  for (const [key, col] of [['name', 'name'], ['address', 'address'], ['city', 'city'],
    ['country', 'country'], ['phone', 'phone'], ['email', 'email'],
    ['checkInTime', 'check_in_time'], ['checkOutTime', 'check_out_time']]) {
    const v = f(wantProp, key, snake(key), col);
    if (v !== undefined && String(property[col] ?? '') !== String(v)) propPatch[col] = v;
  }
  if (Object.keys(propPatch).length) {
    if (!DRY) await props.updateProperty(organizationId, property.id, propPatch);
    say.changed(`обʼєкт ${property.name}: ${Object.keys(propPatch).join(', ')}`);
  } else {
    say.same(`обʼєкт ${property.name}`);
  }

  // ── зміст гостьової сторінки ──────────────────────────────────────────────
  //
  // Те, що гість читає замість того, щоб питати рецепцію: маршрут до гаража,
  // час сніданку, правила, wifi. Досі це можна було ввести лише руками в
  // адмінці, тобто зміст жив у голові того, хто його вводив, і при заведенні
  // другого готелю починався з нуля.
  //
  // Пишуться ЛИШЕ названі у файлі поля. Відсутнє поле — не «стерти», а
  // «про це файл нічого не каже»: половина цих полів зʼявляється після
  // поїздки в готель, і чернетка не має права затирати те, що рецепція вже
  // ввела руками.
  const guestPage = plan.guestPage || plan.guest_page;
  if (guestPage) {
    const COLS = ['wifi_network', 'wifi_password', 'restaurant_name', 'restaurant_hours',
      'restaurant_menu_url', 'rules', 'useful_info', 'faq_items', 'maps_url',
      'territory_map_url', 'pets_policy', 'parking_info', 'video_guide_url',
      'emergency_phone'];
    const has = await sql.row(
      'SELECT * FROM property_guest_config WHERE property_id = ?', [property.id]);
    const patch = {};
    for (const col of COLS) {
      const v = f(guestPage, camel(col), col);
      if (v === undefined) continue;
      const want = v === null ? null : String(v);
      if (String(has?.[col] ?? '') !== String(want ?? '')) patch[col] = want;
    }
    const label = `гостьова сторінка: ${Object.keys(patch).join(', ') || 'без змін'}`;
    if (!Object.keys(patch).length) {
      say.same('гостьова сторінка');
    } else if (DRY) {
      say[has ? 'changed' : 'made'](`[суха] ${label}`);
    } else if (has) {
      const set = Object.keys(patch).map((c) => `${c} = ?`).join(', ');
      await sql.run(
        `UPDATE property_guest_config SET ${set}, updated_at = CURRENT_TIMESTAMP
          WHERE property_id = ?`,
        [...Object.values(patch), property.id]);
      say.changed(label);
    } else {
      const cols = Object.keys(patch);
      await sql.run(
        `INSERT INTO property_guest_config (id, property_id, ${cols.join(', ')})
         VALUES (?, ?, ${cols.map(() => '?').join(', ')})`,
        [crypto.randomUUID(), property.id, ...cols.map((c) => patch[c])]);
      say.made(label);
    }
  }

  // ── ставки ПДВ ────────────────────────────────────────────────────────────
  //
  // Ставка не редагується, а закривається датою (див. invoicing-config): вона
  // вже записана числом на виставлених нарахуваннях. Тому тут лише «є така
  // ставка з такою датою початку — чи нема».
  for (const t of plan.taxRates || plan.tax_rates || []) {
    const code = both(t, 'code');
    const rate = Number(both(t, 'rate'));
    const from = both(t, 'validFrom') || '2020-01-01';
    const label = `ПДВ ${code} ${rate}% з ${from}`;
    const has = await sql.row(
      'SELECT id, rate FROM fin_tax_rates WHERE organization_id = ? AND code = ? AND valid_from = ?',
      [organizationId, code, from]);
    if (has) { say.same(label); continue; }
    if (DRY) { say.made(`[суха] ${label}`); continue; }
    await sql.run(
      `INSERT INTO fin_tax_rates (id, organization_id, code, rate, label, valid_from, valid_to)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), organizationId, code, rate, both(t, 'label') ?? null, from,
        both(t, 'validTo') ?? null]);
    say.made(label);
  }

  // ── серії фактур ──────────────────────────────────────────────────────────
  for (const s of plan.invoiceSeries || plan.invoice_series || []) {
    const code = String(both(s, 'code') || '').toUpperCase();
    const format = both(s, 'numberFormat') || '{prefix}{seq:4}';
    const has = await sql.row(
      'SELECT id, prefix, number_format FROM invoice_series WHERE organization_id = ? AND code = ?',
      [organizationId, code]);
    const prefix = both(s, 'prefix') ?? '';
    if (has) {
      if (has.prefix === prefix && has.number_format === format) { say.same(`серія ${code}`); continue; }
      // Формат номера міняти можна, поки рік не почався; це рішення готелю, і
      // воно тут просто виконується, а не оцінюється.
      if (!DRY) await sql.run(
        'UPDATE invoice_series SET prefix = ?, number_format = ? WHERE id = ? AND organization_id = ?',
        [prefix, format, has.id, organizationId]);
      say.changed(`серія ${code}`);
      continue;
    }
    if (DRY) { say.made(`[суха] серія ${code}`); continue; }
    await sql.run(
      `INSERT INTO invoice_series (id, organization_id, code, channel, prefix, number_format, is_default, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ${both(s, 'isDefault') ? 'TRUE' : 'FALSE'}, ?)`,
      [crypto.randomUUID(), organizationId, code, both(s, 'channel') ?? null, prefix, format,
        Number(both(s, 'sortOrder')) || 0]);
    say.made(`серія ${code}`);
  }

  // ── категорії ─────────────────────────────────────────────────────────────
  const catByName = new Map((await cats.listCategories(organizationId)).map((c) => [c.name, c]));
  for (const c of plan.categories || []) {
    const name = both(c, 'name');
    if (catByName.has(name)) { say.same(`категорія ${name}`); continue; }
    if (DRY) { say.made(`[суха] категорія ${name}`); continue; }
    const made = await cats.createCategory(organizationId, {
      property_id: property.id, name, type: both(c, 'type') || 'hotel',
      icon: both(c, 'icon'), color: both(c, 'color'),
      sort_order: Number(both(c, 'sortOrder')) || 0,
    });
    if (!made) { say.refused(`категорія ${name}`, 'обʼєкт не цієї організації'); continue; }
    catByName.set(name, made);
    say.made(`категорія ${name}`);
  }
  // Обʼєкт завжди має принаймні одну категорію — її створює provisionOrganization.
  const defaultCategory = catByName.values().next().value;
  const categoryOf = (n) => (n ? catByName.get(n) : defaultCategory) || defaultCategory;

  // ── будівлі ───────────────────────────────────────────────────────────────
  const buildByName = new Map(
    (await builds.listBuildings(organizationId, { property_id: property.id })).map((b) => [b.name, b]));
  for (const b of plan.buildings || []) {
    const name = both(b, 'name');
    if (buildByName.has(name)) { say.same(`будівля ${name}`); continue; }
    if (DRY) { say.made(`[суха] будівля ${name}`); continue; }
    const cat = categoryOf(both(b, 'category'));
    const made = await builds.createBuilding(organizationId, {
      property_id: property.id, category_id: cat.id, name,
      code: both(b, 'code') || name, sort_order: Number(both(b, 'sortOrder')) || 0,
    });
    if (!made) { say.refused(`будівля ${name}`, 'обʼєкт або категорія не цієї організації'); continue; }
    buildByName.set(name, made);
    say.made(`будівля ${name}`);
  }

  // ── типи номерів, а з ними ціни й LOS ─────────────────────────────────────
  const typeByCode = new Map((await types.listUnitTypes(organizationId)).map((t) => [t.code, t]));
  for (const t of plan.unitTypes || plan.unit_types || []) {
    const code = both(t, 'code');
    let ut = typeByCode.get(code);
    if (!ut) {
      if (DRY) { say.made(`[суха] тип ${code}`); continue; }
      const building = both(t, 'building');
      ut = await types.createUnitType(organizationId, {
        property_id: property.id,
        category_id: categoryOf(both(t, 'category')).id,
        building_id: building ? buildByName.get(building)?.id : undefined,
        name: both(t, 'name') || code, code,
        max_adults: Number(both(t, 'maxAdults')) || 2,
        max_children: Number(both(t, 'maxChildren')) || 0,
        max_occupancy: Number(both(t, 'maxOccupancy')) || Number(both(t, 'maxAdults')) || 2,
        base_occupancy: Number(both(t, 'baseOccupancy')) || 2,
        extra_bed_available: !!both(t, 'extraBedAvailable'),
        sort_order: Number(both(t, 'sortOrder')) || 0,
        // «online nicht buchbar, nur auf Anfrage» — рецепція продає, сайт ні.
        // Відсутнє поле = продається онлайн, як і всі типи до цього поля.
        bookable_online: both(t, 'bookableOnline') ?? true,
        // Чи входить сніданок у ціни ЦЬОГО типу. Відсутнє = вирішує правило
        // каналу; false — апартаменти, де сніданок «zzgl. 15 € / Person».
        breakfast_included: both(t, 'breakfastIncluded') ?? null,
      });
      if (!ut) { say.refused(`тип ${code}`, 'обʼєкт, категорія або будівля не цієї організації'); continue; }
      typeByCode.set(code, ut);
      say.made(`тип ${code} — ${ut.name}`);
    } else {
      say.same(`тип ${code}`);
    }

    // Матриця заселеності. Ключ рядка — тип + осіб + вікно дат; збіг за ключем
    // і різна сума означає, що готель змінив ціну, а не додав другу.
    for (const p of both(t, 'occupancyPrices') || t.prices || []) {
      const persons = Number(both(p, 'persons'));
      const price = Number(f(p, 'priceGross', 'price_gross', 'price'));
      const from = both(p, 'validFrom') ?? null;
      const to = both(p, 'validTo') ?? null;
      const label = `   ціна ${code} ×${persons} ${from || '—'}…${to || '—'} = ${price}`;
      // `COALESCE(valid_from, '0001-01-01') = COALESCE(?, '0001-01-01')` тут
      // читалося б рівніше — і вбивало б прогін на Postgres із
      // `operator does not exist: date = text`: колонка виводить тип `date`,
      // а параметру всередині COALESCE його виводити нізвідки. На SQLite,
      // де типу дати немає взагалі, воно проходить. Параметр, порівняний
      // прямо з колонкою, тип від неї й отримує.
      const from_ = from == null ? { sql: 'valid_from IS NULL', p: [] } : { sql: 'valid_from = ?', p: [from] };
      const to_ = to == null ? { sql: 'valid_to IS NULL', p: [] } : { sql: 'valid_to = ?', p: [to] };
      const has = await sql.row(
        `SELECT id, price_gross, label FROM price_occupancy
          WHERE organization_id = ? AND property_id = ? AND unit_type_id = ? AND persons = ?
            AND ${from_.sql} AND ${to_.sql}`,
        [organizationId, property.id, ut.id, persons, ...from_.p, ...to_.p]);
      // Назва періоду теж звіряється, а не тільки сума: підпис рядка — це те,
      // як період зветься на екрані цін, і виправлення однієї лише назви у
      // файлі мовчки не доїжджало до бази.
      const name = both(p, 'label') ?? null;
      if (has && Number(has.price_gross) === price && (has.label ?? null) === name) { say.same(label); continue; }
      if (DRY) { say[has ? 'changed' : 'made'](`[суха]${label}`); continue; }
      if (has) {
        await pricing.updatePrice(has.id, price, name);
        say.changed(label);
      } else {
        const id = await pricing.createPrice(property.id, {
          unit_type_id: ut.id, persons, price_gross: price,
          valid_from: from, valid_to: to, label: name,
        });
        id ? say.made(label) : say.refused(label, 'відмовлено');
      }
    }

    for (const l of both(t, 'losTiers') || t.los || []) {
      const min = Number(both(l, 'minNights'));
      const adj = Number(f(l, 'adjustmentGross', 'adjustment_gross', 'adjustment'));
      const persons = both(l, 'persons') ?? null;
      const label = `   LOS ${code} від ${min} ноч. ×${persons ?? 'будь-скільки'} = ${adj}`;
      const occ = persons == null ? { sql: 'persons IS NULL', p: [] } : { sql: 'persons = ?', p: [persons] };
      const has = await sql.row(
        `SELECT id, adjustment_gross, label FROM price_los_tiers
          WHERE organization_id = ? AND property_id = ? AND unit_type_id = ? AND min_nights = ?
            AND ${occ.sql}`,
        [organizationId, property.id, ut.id, min, ...occ.p]);
      const name = both(l, 'label') ?? null;
      if (has && Number(has.adjustment_gross) === adj && (has.label ?? null) === name) { say.same(label); continue; }
      if (DRY) { say[has ? 'changed' : 'made'](`[суха]${label}`); continue; }
      if (has) {
        await pricing.updateTier(has.id, adj, name);
        say.changed(label);
      } else {
        const id = await pricing.createTier(property.id, {
          unit_type_id: ut.id, min_nights: min, adjustment_gross: adj,
          persons: persons === null ? null : Number(persons), label: name,
        });
        id ? say.made(label) : say.refused(label, 'відмовлено');
      }
    }
  }

  // ── номери ────────────────────────────────────────────────────────────────
  //
  // Діапазоном або поштучно. bulkCreateUnits сам пропускає вже наявні номери,
  // тому повторний прогін нічого не дублює й нічого не переписує.
  for (const u of plan.units || []) {
    const typeCode = f(u, 'unitType', 'unit_type', 'unitTypeCode', 'unit_type_code');
    const ut = typeByCode.get(typeCode);
    if (!ut) { say.refused(`номери типу ${typeCode}`, 'такого типу у файлі не описано'); continue; }
    const building = both(u, 'building');
    const from = both(u, 'from');

    if (from !== undefined) {
      const prefix = both(u, 'prefix') ?? '';
      const to = both(u, 'to');
      const label = `номери ${prefix}${from}–${prefix}${to} → ${typeCode}`;
      if (DRY) { say.made(`[суха] ${label}`); continue; }
      const made = await units.bulkCreateUnits(organizationId, {
        property_id: property.id, category_id: ut.category_id, unit_type_id: ut.id,
        building_id: building ? buildByName.get(building)?.id : ut.building_id ?? undefined,
        prefix, from: Number(from), to: Number(to),
        floor: both(u, 'floor') ?? null,
        beds: Number(both(u, 'beds')) || 0, zone: both(u, 'zone'),
      });
      if (made === null) { say.refused(label, 'ідентифікатори не цієї організації'); continue; }
      made.length ? say.made(`${label}: ${made.length} нових`) : say.same(label);
      continue;
    }

    const code = String(both(u, 'code') || both(u, 'name'));
    const label = `номер ${code} → ${typeCode}`;
    const has = await sql.row(
      'SELECT id FROM units WHERE property_id = ? AND code = ?', [property.id, code]);
    if (has) { say.same(label); continue; }
    if (DRY) { say.made(`[суха] ${label}`); continue; }
    const made = await units.createUnit(organizationId, {
      property_id: property.id, category_id: ut.category_id, unit_type_id: ut.id,
      building_id: building ? buildByName.get(building)?.id : ut.building_id ?? undefined,
      name: both(u, 'name') || code, code,
      floor: both(u, 'floor'), beds: Number(both(u, 'beds')) || 0, zone: both(u, 'zone'),
    });
    made ? say.made(label) : say.refused(label, 'відмовлено');
  }

  // ── правила каналів ───────────────────────────────────────────────────────
  for (const c of plan.channelRules || plan.channel_rules || []) {
    const channel = both(c, 'channel') ? String(both(c, 'channel')).trim().toLowerCase() : null;
    const label = `правило каналу ${channel || '(за замовчуванням)'}`;
    const includes = both(c, 'includesBreakfast') ? 'TRUE' : 'FALSE';
    const food = Number(both(c, 'breakfastFoodPrice')) || 0;
    const drinks = Number(both(c, 'breakfastDrinksPrice')) || 0;
    const markup = Number(both(c, 'markupPercent')) || 0;
    const lodging = both(c, 'lodgingTaxCode') || 'reduced';
    const foodCode = both(c, 'foodTaxCode') || 'reduced';
    const drinksCode = both(c, 'drinksTaxCode') || 'standard';

    const has = await sql.row(
      `SELECT id, includes_breakfast, breakfast_food_price, breakfast_drinks_price,
              lodging_tax_code, food_tax_code, drinks_tax_code, markup_percent
         FROM channel_rate_rules
        WHERE organization_id = ? AND property_id = ? AND COALESCE(channel, '') = COALESCE(?, '')`,
      [organizationId, property.id, channel]);

    if (has) {
      const same = String(!!has.includes_breakfast || has.includes_breakfast === 1) === String(includes === 'TRUE')
        && Number(has.breakfast_food_price) === food
        && Number(has.breakfast_drinks_price) === drinks
        && has.lodging_tax_code === lodging && has.food_tax_code === foodCode
        && has.drinks_tax_code === drinksCode && Number(has.markup_percent) === markup;
      if (same) { say.same(label); continue; }
      if (DRY) { say.changed(`[суха] ${label}`); continue; }
      await sql.run(
        `UPDATE channel_rate_rules
            SET includes_breakfast = ${includes}, breakfast_food_price = ?, breakfast_drinks_price = ?,
                lodging_tax_code = ?, food_tax_code = ?, drinks_tax_code = ?, markup_percent = ?
          WHERE id = ? AND organization_id = ?`,
        [food, drinks, lodging, foodCode, drinksCode, markup, has.id, organizationId]);
      say.changed(label);
      continue;
    }
    if (DRY) { say.made(`[суха] ${label}`); continue; }
    await sql.run(
      `INSERT INTO channel_rate_rules
         (id, organization_id, property_id, channel, includes_breakfast,
          breakfast_food_price, breakfast_drinks_price,
          lodging_tax_code, food_tax_code, drinks_tax_code, markup_percent)
       VALUES (?, ?, ?, ?, ${includes}, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), organizationId, property.id, channel, food, drinks,
        lodging, foodCode, drinksCode, markup]);
    say.made(label);
  }

  // ── послуги ───────────────────────────────────────────────────────────────
  //
  // vat_code обовʼязковий (міграція 0017): послуга без нього зупиняє ВСЮ
  // проводку рахунку, тому краще відмовити тут, ніж на виїзді гостя.
  for (const s of plan.services || []) {
    const name = both(s, 'name');
    const vat = both(s, 'vatCode');
    if (!vat) { say.refused(`послуга ${name}`, 'без vatCode — вона зупинить проводку рахунку'); continue; }
    const price = Number(both(s, 'price')) || 0;
    const has = await sql.row(
      'SELECT id, price, vat_code FROM additional_services WHERE property_id = ? AND name = ?',
      [property.id, name]);
    if (has && Number(has.price) === price && has.vat_code === vat) { say.same(`послуга ${name}`); continue; }
    if (DRY) { say[has ? 'changed' : 'made'](`[суха] послуга ${name}`); continue; }
    if (has) {
      await sql.run('UPDATE additional_services SET price = ?, vat_code = ? WHERE id = ? AND property_id = ?',
        [price, vat, has.id, property.id]);
      say.changed(`послуга ${name}`);
    } else {
      // `category` тут — не категорія номерів, а рубрика послуги, і вона під
      // CHECK: food / wellness / sport / entertainment / other. Порожнє —
      // 'other', бо NOT NULL, а не тому що ми знаємо, що це «інше».
      await sql.run(
        `INSERT INTO additional_services (id, property_id, name, price, currency, vat_code, service_type, category, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [crypto.randomUUID(), property.id, name, price, both(s, 'currency') || 'EUR', vat,
          both(s, 'serviceType') || 'simple', both(s, 'category') || 'other']);
      say.made(`послуга ${name}`);
    }
  }

  // ── зали ──────────────────────────────────────────────────────────────────
  //
  // Ціни блоків — ПІДКАЗКИ (власник: «Preise sind variabel … manuell
  // einpflegbar»), тому збіг чи розбіжність рахується по JSON цін цілком:
  // готель, що прибрав у файлі ціну «до 2 год», прибрав її і в системі.
  for (const s of plan.eventSpaces || plan.event_spaces || []) {
    const code = both(s, 'code');
    const name = both(s, 'name') || code;
    const prices = both(s, 'blockPrices') ?? null;
    const pricesJson = prices == null ? null : JSON.stringify(prices);
    // Which VAT the rent carries is the hall's own answer — see migration 0025.
    // Absent in the file means 'standard', the rate every hall carried before
    // the column existed.
    const vat = both(s, 'vatCode') || 'standard';
    const label = `зала ${code} — ${name} (ПДВ ${vat})`;
    const has = await sql.row(
      'SELECT id, name, capacity_note, block_prices, vat_code FROM event_spaces WHERE property_id = ? AND code = ?',
      [property.id, code]);
    const capacity = both(s, 'capacityNote') ?? null;
    if (has && has.name === name && (has.capacity_note ?? null) === capacity
        && (has.block_prices ?? null) === pricesJson
        && (has.vat_code ?? 'standard') === vat) { say.same(label); continue; }
    if (DRY) { say[has ? 'changed' : 'made'](`[суха] ${label}`); continue; }
    if (has) {
      await sql.run(
        `UPDATE event_spaces SET name = ?, capacity_note = ?, block_prices = ?, vat_code = ?, sort_order = ?
          WHERE id = ? AND organization_id = ?`,
        [name, capacity, pricesJson, vat, Number(both(s, 'sortOrder')) || 0, has.id, organizationId]);
      say.changed(label);
    } else {
      await sql.run(
        `INSERT INTO event_spaces (id, organization_id, property_id, name, code, capacity_note, block_prices, vat_code, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [crypto.randomUUID(), organizationId, property.id, name, code, capacity,
          pricesJson, vat, Number(both(s, 'sortOrder')) || 0]);
      say.made(label);
    }
  }

  for (const a of plan.eventAddons || plan.event_addons || []) {
    const name = both(a, 'name');
    const kind = both(a, 'kind') || 'flat';
    const vat = both(a, 'vatCode');
    // Та сама причина, що в послуг: рядок без податкової ролі зупинить
    // проводку рахунку в найгірший момент — коли клієнт стоїть поруч.
    if (!vat) { say.refused(`доплата ${name}`, 'без vatCode — вона зупинить проводку рахунку'); continue; }
    const price = Number(both(a, 'price') ?? both(a, 'priceGross')) || 0;
    const note = both(a, 'note') ?? null;
    const label = `доплата ${name} (${kind}) = ${price}`;
    const has = await sql.row(
      'SELECT id, kind, price_gross, vat_code, note FROM event_addons WHERE property_id = ? AND name = ?',
      [property.id, name]);
    if (has && has.kind === kind && Number(has.price_gross) === price
        && has.vat_code === vat && (has.note ?? null) === note) { say.same(label); continue; }
    if (DRY) { say[has ? 'changed' : 'made'](`[суха] ${label}`); continue; }
    if (has) {
      await sql.run(
        `UPDATE event_addons SET kind = ?, price_gross = ?, vat_code = ?, note = ?, sort_order = ?
          WHERE id = ? AND organization_id = ?`,
        [kind, price, vat, note, Number(both(a, 'sortOrder')) || 0, has.id, organizationId]);
      say.changed(label);
    } else {
      await sql.run(
        `INSERT INTO event_addons (id, organization_id, property_id, name, kind, price_gross, vat_code, note, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [crypto.randomUUID(), organizationId, property.id, name, kind, price, vat, note,
          Number(both(a, 'sortOrder')) || 0]);
      say.made(label);
    }
  }

  // ── приймальні перевірки ──────────────────────────────────────────────────
  //
  // Найважливіша частина файла. Усе вище лише записує рядки; ось це питає в
  // системи ту саму ціну, яку побачить гість, і порівнює з тим, що готель
  // назвав сам. Заведення без цього — це «рядки лягли», а не «продає правильно».
  const checks = plan.acceptance || plan.quotes || [];
  if (checks.length && !DRY) {
    console.log('\n  приймальні перевірки цін');
    for (const q of checks) {
      const typeCode = f(q, 'unitType', 'unit_type', 'unitTypeCode', 'unit_type_code');
      const ut = typeByCode.get(typeCode);
      const persons = Number(both(q, 'persons'));
      const checkIn = both(q, 'checkIn');
      const nights = Number(both(q, 'nights')) || daysBetween(checkIn, both(q, 'checkOut'));
      const expect = Number(f(q, 'expectTotal', 'expect_total', 'expect'));
      const label = `${typeCode} ×${persons} ${checkIn} на ${nights} ноч. → чекаємо ${expect}`;
      if (!ut) { say.refused(label, 'типу немає'); continue; }
      const quote = await priceNights({ unitTypeId: ut.id, checkIn, nights, persons });
      if (quote.missing.length) {
        say.refused(label, `неоцінені ночі: ${quote.missing.join(', ')}`);
        continue;
      }
      if (Math.abs(quote.total - expect) < 0.005) say.same(`${label} — збіглось`);
      else say.refused(label, `система рахує ${quote.total}`);
    }
  }
}

function daysBetween(from, to) {
  if (!from || !to) return 1;
  const a = Date.UTC(...from.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n)));
  const b = Date.UTC(...to.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n)));
  return Math.max(1, Math.round((b - a) / 86400000));
}
