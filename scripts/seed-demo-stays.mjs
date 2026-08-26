/**
 * Демо-проживання для показу системи — і тільки там, де показують.
 *
 *   node scripts/seed-demo-stays.mjs --all --env beta
 *   node scripts/seed-demo-stays.mjs hotels/x.json --env beta [--wipe]
 *
 * Порожній календар нічого не продає: на демонстрації власник має бачити
 * заїзди сьогодні, гостей у будинку і виїзд, який щойно відбувся, — інакше
 * система виглядає як макет. Цей скрипт заводить кілька ВИГАДАНИХ гостей і
 * бронювань поверх реальної структури готелю: справжні номери, справжня
 * матриця цін, справжній розрахунок вартості (quoteStay — той самий код, що
 * рахує броні). Жодної живої персони: імена зі списку-заглушки, пошта на
 * example.com.
 *
 * Правила, які цей файл обіцяє:
 *   — НІКОЛИ не на проді: `--env prod` — відмова ще до відкриття бази.
 *     Виклик без --env — теж відмова: збіг обставин не є дозволом.
 *   — ідемпотентно: бронювання мають фіксовані id (r_demo_…), другий прогін
 *     нічого не подвоїть;
 *   — не чіпає живі дані: перетин із наявною бронею означає «пропустити
 *     номер», а не «посунути бронь»;
 *   — нічого не знає про конкретний готель: структура читається з БД
 *     організації, файл готелю дає лише slug (AGENTS: бізнес клієнта —
 *     у hotels/*.json, не в коді).
 *
 * --wipe прибирає раніше засіяні демо-броні цієї організації (тільки їх:
 * за префіксом id) — щоб перед зустріччю почати з чистого аркуша.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';

// Той самий резолвер аліасів, що в apply-hotel.mjs, і з тієї ж причини: на
// сервері цей файл виконує голий node без бандлера. Історія — там.
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
const ALL = args.includes('--all');
const WIPE = args.includes('--wipe');
const envIdx = args.indexOf('--env');
const ENV = envIdx >= 0 ? args[envIdx + 1] : null;
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--env');

if (!ENV) {
  console.error('seed-demo-stays: --env <назва> обовʼязковий — щоб «де я» було сказано, а не вгадано');
  process.exit(2);
}
if (ENV === 'prod') {
  // Не помилка деплою — свідома відмова. Демо-гості на проді — це бруд у
  // реальному календарі готелю, і жодного сценарію, де це доречно, немає.
  console.log('seed-demo-stays: prod — демо-дані не сіються. Це не збій, це правило.');
  process.exit(0);
}
if (!ALL && files.length === 0) {
  console.error('usage: node scripts/seed-demo-stays.mjs <hotels/x.json>|--all --env <env> [--wipe]');
  process.exit(2);
}

const isTemplate = (name) => name.startsWith('_') || name.startsWith('.');
const targets = ALL
  ? (fs.existsSync('hotels')
      ? fs.readdirSync('hotels').filter((f) => f.endsWith('.json') && !isTemplate(f))
        .sort().map((f) => path.join('hotels', f))
      : [])
  : files;

if (targets.length === 0) {
  console.log('готелів немає — сіяти нікуди');
  process.exit(0);
}

const { runWithOrganization } = await import('../src/core/auth/tenant-context.ts');
const { getSql } = await import('../src/core/db/async.ts');
const { findOrCreateGuest } = await import('../src/modules/guests/data/guest-dedup.repo.ts');
const { loadMatrix } = await import('../src/modules/pricing/data/occupancy-price.repo.ts');
const { quoteStay, addDays } = await import('../src/modules/pricing/domain/occupancy-price.ts');

let failures = 0;
const say = {
  made: (what) => console.log(`  +  ${what}`),
  same: (what) => console.log(`  =  ${what}`),
  skipped: (what, why) => console.log(`  ·  ${what} — ${why}`),
  refused: (what, why) => { failures++; console.log(`  !  ${what} — ${why}`); },
};

/**
 * Вигадані гості. Це заглушки на кшталт Mustermann, не записи про людей:
 * пошта незнімна на example.com (RFC 2606), телефони — неіснуючий діапазон.
 */
const PEOPLE = [
  { first: 'Thomas',    last: 'Bergmann', email: 'thomas.bergmann@example.com', phone: '+49 151 5550101' },
  { first: 'Sabine',    last: 'Krüger',   email: 'sabine.krueger@example.com',  phone: '+49 151 5550102' },
  { first: 'Michael',   last: 'Hoffmann', email: null,                          phone: '+49 151 5550103' },
  { first: 'Julia',     last: 'Weber',    email: 'julia.weber@example.com',     phone: null },
  { first: 'Frank',     last: 'Neumann',  email: null,                          phone: '+49 151 5550105' },
  { first: 'Petra',     last: 'Schulze',  email: 'petra.schulze@example.com',   phone: '+49 151 5550106' },
  { first: 'Andreas',   last: 'Vogel',    email: null,                          phone: null },
  { first: 'Christine', last: 'Lang',     email: 'christine.lang@example.com',  phone: '+49 151 5550108' },
  { first: 'Martin',    last: 'Richter',  email: null,                          phone: '+49 151 5550109' },
];

/**
 * Сценарій дня: хто в будинку, хто заїжджає, хто щойно виїхав.
 *
 * Зсуви — у днях від «сьогодні» ГОТЕЛЮ (його часовий пояс, не серверний):
 * заїзд о 8-й ранку по UTC — це ще «вчора» для рецепції у CET, і демо,
 * посіяне по серверному годиннику, показувало б заїзди не в тому дні.
 */
const SLOTS = [
  { off: -1, nights: 3, persons: 2, status: 'checked_in',  pay: 'unpaid' },
  { off: -2, nights: 2, persons: 2, status: 'checked_in',  pay: 'paid'   }, // виїзд сьогодні
  { off: -1, nights: 4, persons: 2, status: 'checked_in',  pay: 'unpaid' },
  { off:  0, nights: 2, persons: 1, status: 'confirmed',   pay: 'unpaid' }, // заїзд сьогодні
  { off:  0, nights: 3, persons: 4, status: 'confirmed',   pay: 'unpaid' }, // заїзд сьогодні
  { off:  1, nights: 5, persons: 2, status: 'confirmed',   pay: 'unpaid' },
  { off:  3, nights: 2, persons: 2, status: 'confirmed',   pay: 'unpaid' },
  { off: -4, nights: 3, persons: 2, status: 'checked_out', pay: 'paid'   }, // історія
  { off:  5, nights: 2, persons: 2, status: 'confirmed',   pay: 'unpaid' },
];

function todayIn(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

for (const file of targets) {
  console.log(`\n${'─'.repeat(70)}\n${file} — демо-проживання\n${'─'.repeat(70)}`);
  try {
    await seedOne(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    failures++;
    console.error(`  !  ${file} — ${e?.message || e}`);
  }
}
console.log(failures === 0 ? '\nдемо-дані на місці' : `\n${failures} відмов — дивіться вище`);
process.exit(failures === 0 ? 0 : 1);

// ────────────────────────────────────────────────────────────────────────────

async function seedOne(plan) {
  const slug = plan.organization?.slug || plan.organization?.Slug;
  if (!slug) throw new Error('у файлі немає organization.slug');
  const sql = getSql();
  const org = await sql.row('SELECT id, timezone, default_currency FROM organizations WHERE slug = ?', [slug]);
  if (!org) { say.skipped(slug, 'організації ще немає — спершу apply-hotel'); return; }

  await runWithOrganization(org.id, async () => {
    const property = await sql.row(
      'SELECT id FROM properties WHERE organization_id = ? ORDER BY created_at LIMIT 1', [org.id]);
    if (!property) { say.skipped(slug, 'обʼєкта ще немає'); return; }

    if (WIPE) {
      const gone = await sql.run(
        "DELETE FROM reservations WHERE organization_id = ? AND id LIKE 'r_demo_%'", [org.id]);
      console.log(`  ~  прибрано демо-бронювань: ${gone.changes}`);
    }

    // Реальні номери готелю, згруповані за типом. Пул і неактивні — не житло.
    const units = await sql.rows(
      `SELECT u.id, u.code, u.unit_type_id, t.name AS type_name, t.max_occupancy
         FROM units u JOIN unit_types t ON t.id = u.unit_type_id
        WHERE u.property_id = ? AND u.is_active = 1 AND u.is_pool = 0
        ORDER BY t.max_occupancy, u.code`, [property.id]);
    if (units.length === 0) { say.skipped(slug, 'номерів немає'); return; }

    const matrix = await loadMatrix(property.id);
    const today = todayIn(org.timezone);
    const used = new Set();

    // Різні типи в різних бронях: демо, де всі живуть в одній категорії,
    // нічого не демонструє. Черга типів — за місткістю, щоб сімейний слот
    // дістав номер, куди четверо справді вміщаються.
    const byType = new Map();
    for (const u of units) {
      if (!byType.has(u.unit_type_id)) byType.set(u.unit_type_id, []);
      byType.get(u.unit_type_id).push(u);
    }
    const typeQueue = [...byType.values()];
    let cursor = 0;

    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i];
      const person = PEOPLE[i % PEOPLE.length];
      const id = `r_demo_${org.id.replace(/-/g, '').slice(0, 8)}_${String(i + 1).padStart(2, '0')}`;
      const checkIn = addDays(today, slot.off);
      const checkOut = addDays(checkIn, slot.nights);
      const who = `${person.first} ${person.last}`;

      const existing = await sql.row('SELECT id FROM reservations WHERE id = ?', [id]);
      if (existing) { say.same(`${who} · ${checkIn}→${checkOut}`); continue; }

      // Номер: обходимо типи по колу; підходить той, куди вміщаються гості,
      // на чиї дати є ціна і чиї ночі ніким не зайняті.
      let picked = null; let quote = null;
      for (let step = 0; step < typeQueue.length && !picked; step++) {
        const pool = typeQueue[(cursor + step) % typeQueue.length];
        const type = pool[0];
        if (Number(type.max_occupancy) < slot.persons) continue;
        const q = quoteStay({
          checkIn, nights: slot.nights, persons: slot.persons,
          unitTypeId: type.unit_type_id, matrix: matrix.prices, losTiers: matrix.tiers,
        });
        if (q.missing.length > 0) continue;
        for (const u of pool) {
          if (used.has(u.id)) continue;
          const busy = await sql.row(
            `SELECT 1 FROM reservations
              WHERE unit_id = ? AND status NOT IN ('cancelled', 'no_show')
                AND check_in < ? AND check_out > ? LIMIT 1`, [u.id, checkOut, checkIn]);
          if (busy) continue;
          picked = u; quote = q;
          cursor = (cursor + step + 1) % typeQueue.length;
          break;
        }
      }
      if (!picked) { say.skipped(`${who} · ${checkIn}→${checkOut} ×${slot.persons}`, 'вільного номера з ціною немає'); continue; }

      const guest = await findOrCreateGuest({
        organizationId: org.id,
        firstName: person.first, lastName: person.last,
        email: person.email, phone: person.phone,
        country: 'DE',
      });

      // Той самий INSERT, що робить POST /api/bookings, з тих самих полів:
      // демо-бронь не має відрізнятись від живої нічим, крім свого id.
      const token = (slot.status === 'confirmed' || slot.status === 'checked_in')
        ? crypto.randomBytes(16).toString('hex') : null;
      await sql.run(
        `INSERT INTO reservations
           (id, organization_id, property_id, unit_id, guest_id, check_in, check_out,
            nights, adults, children, status, payment_status, source, total_price,
            currency, commission_amount, guest_page_token, city_tax_amount,
            city_tax_included, city_tax_paid, internal_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, org.id, property.id, picked.id, guest.id, checkIn, checkOut,
         slot.nights, slot.persons, 0, slot.status, slot.pay, 'direct', quote.total,
         org.default_currency || 'EUR', 0, token, 0, 0, 'pending', 'Demo']);
      say.made(`${who} · ${picked.type_name} ${picked.code} · ${checkIn}→${checkOut} ×${slot.persons} = ${quote.total}`);
    }
  });
}
