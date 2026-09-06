/**
 * Статус оплати: що колонка ДОЗВОЛЯЄ і що екран уміє НАЗВАТИ — одна множина.
 *
 *   node src/modules/bookings/data/payment-status.check.ts
 *
 * Написано ДО виправлення (інваріант 24) і було червоним двічі: колонка не
 * приймала `partial`, і словник екрана його не знав.
 *
 * Що зламалось у продукті. `reservations.payment_status` мав CHECK на чотири
 * значення (`unpaid`, `payment_requested`, `prepaid`, `paid`), а ДВА писачі
 * ставлять пʼяте — `partial`:
 *   - `finance/api/operations.handlers.ts:891` — після кожної операції з
 *     бронню перераховує сплачене й ставить `partial`, коли гроші прийшли,
 *     але не всі;
 *   - `app/api/payments/route.ts:139` — `type: deposit` і `type: partial`.
 * Обидва впирались у CHECK. Внесок при цьому вже записаний, а відповідь —
 * помилка: депозит лягав у фінанси, бронь лишалась «не оплачено», і оператор,
 * побачивши помилку, мав усі підстави провести оплату вдруге.
 *
 * Тому тут не одне твердження, а рівність двох множин: усе, що дозволяє база,
 * має мати слово на екрані, і навпаки. Нове значення в CHECK без слова —
 * сирий токен в оператора; слово без значення — мертвий пункт фільтра.
 *
 * Осі (інваріант 26). Статус оплати — ТРИ різні значення в засіві
 * (`unpaid` 1, `partial` 2, `paid` 1), і числа обрано несумісними з
 * альтернативними прочитаннями: «частково» дає 2, «не повністю оплачені» дало
 * б 3, «усі» — 4. Друга вісь — чи CHECK узагалі діє: вигадане значення мусить
 * бути ВІДХИЛЕНЕ, інакше перше твердження зелене на базі без обмеження.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { PAYMENT_STATUS_VALUES, PAYMENT_STATUS_MAP, paymentStatusLabel } = await import('../ui/payment-status.ts');

const sql = getSql();
const ORG = '__paystat__org';
const PROP = '__paystat__prop';
const ids = { cat: '__paystat__cat', ut: '__paystat__ut', unit: '__paystat__unit', guest: '__paystat__guest' };

async function cleanup() {
  await sql.run("DELETE FROM reservations WHERE id LIKE '__paystat__%'", []);
  await sql.run('DELETE FROM guests WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, 'CZK')", [ORG, 'Pay', 'paystat']);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run("INSERT INTO properties (id, organization_id, name, slug, country) VALUES (?, ?, 'House', 'paystat', 'CZ')", [PROP, ORG]);
    await sql.run("INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, 'Rooms', 'resort')", [ids.cat, PROP]);
    await sql.run("INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, 'Double', 'DBL')", [ids.ut, PROP, ids.cat]);
    await sql.run("INSERT INTO units (id, unit_type_id, property_id, category_id, name, code) VALUES (?, ?, ?, ?, '101', '101')", [ids.unit, ids.ut, PROP, ids.cat]);
    await sql.run("INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, 'Eva', 'Nová')", [ids.guest, ORG]);

    const stay = (id: string, payment: string) => sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, nights, adults, status, payment_status, total_price, currency)
       VALUES (?, ?, ?, ?, ?, '2026-11-02', '2026-11-04', 2, 2, 'confirmed', ?, 4000, 'CZK')`,
      [id, ORG, PROP, ids.unit, ids.guest, payment]);

    // ── 1. Колонка приймає КОЖНЕ значення словника ────────────────────────
    for (const v of PAYMENT_STATUS_VALUES) {
      await stay(`__paystat__ok_${v}`, v).catch((e: any) => {
        assert.fail(`колонка не приймає '${v}', яке екран уміє назвати «${paymentStatusLabel(v)}»: ${e.message}`);
      });
    }
    console.log(`  ok  колонка приймає всі ${PAYMENT_STATUS_VALUES.length} значення словника`);

    // ── 2. …і НЕ приймає вигаданого: без цього перше твердження порожнє ───
    let refused = false;
    await stay('__paystat__bogus', 'almost_paid').catch(() => { refused = true; });
    assert.ok(refused, 'CHECK не діє: колонка прийняла вигадане значення, тож твердження 1 нічого не доводить');
    console.log('  ok  вигадане значення відхилено — обмеження справді на місці');

    // ── 3. Фільтр «частково» знаходить рівно своїх ────────────────────────
    // Засів: 1 unpaid, 2 partial, 1 paid — числа різні навмисно.
    await sql.run("DELETE FROM reservations WHERE id LIKE '__paystat__%'", []);
    await stay('__paystat__f_unpaid', 'unpaid');
    await stay('__paystat__f_part1', 'partial');
    await stay('__paystat__f_part2', 'partial');
    await stay('__paystat__f_paid', 'paid');

    const countBy = async (status: string) => {
      const row = await sql.row<{ n: number }>(
        "SELECT COUNT(*) AS n FROM reservations WHERE id LIKE '__paystat__%' AND payment_status = ?", [status]);
      return Number(row?.n ?? 0);
    };
    const all = await sql.row<{ n: number }>("SELECT COUNT(*) AS n FROM reservations WHERE id LIKE '__paystat__%'", []);

    assert.strictEqual(await countBy('partial'), 2, '«частково» має дати рівно дві броні');
    assert.strictEqual(await countBy('unpaid'), 1);
    assert.strictEqual(await countBy('paid'), 1);
    assert.strictEqual(Number(all?.n), 4);
    // Альтернативні прочитання, з якими 2 не збігається:
    assert.notStrictEqual(3, await countBy('partial'), 'не «все, що не оплачено повністю»');
    assert.notStrictEqual(4, await countBy('partial'), 'не «всі броні»');
    console.log('  ok  фільтр «частково» дає 2 з 4 — не «не оплачені» (3) і не «всі» (4)');

    // ── 4. Кожне значення має слово, і жодного зайвого слова ──────────────
    for (const v of PAYMENT_STATUS_VALUES) {
      assert.ok(PAYMENT_STATUS_MAP[v]?.label, `значення '${v}' без слова на екрані`);
      assert.notStrictEqual(paymentStatusLabel(v), v, `'${v}' показується оператору сирим токеном`);
    }
    assert.strictEqual(Object.keys(PAYMENT_STATUS_MAP).length, PAYMENT_STATUS_VALUES.length,
      'у словнику є слово для значення, якого в наборі немає — мертвий пункт фільтра');
    console.log('  ok  кожне значення має слово оператора, зайвих слів немає');

    // ── 5. Кольори — токенами, не літералами (друга тема) ────────────────
    for (const [v, look] of Object.entries(PAYMENT_STATUS_MAP)) {
      assert.ok(look.color.startsWith('var(--') && look.bg.startsWith('var(--'),
        `'${v}' пофарбовано літералом: у другій темі він лишиться кольором першої`);
      assert.ok(look.icon && look.icon.trim(), `'${v}' без значка: у смузі планера й на чипах він лишиться порожнім`);
    }
    console.log('  ok  кольори статусів — токени теми, значок є в кожного');

    // ── 6. РІВНІСТЬ, а не включення ──────────────────────────────────────
    //
    // Твердження 1 доводить лише «словник ⊆ дозволене»: значення, яке колонка
    // дозволяє, а словник не знає, воно пропускає — а це рівно той дефект,
    // від якого все почалось (`partial` жив у колонці нікому не відомий).
    // Тому набір читається З ОЗНАЧЕННЯ CHECK і звіряється в обидва боки.
    const ddl = await sql.row<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='reservations'", []);
    if (ddl?.sql) {
      const m = /CHECK \(payment_status IN \(([^)]*)\)\)/.exec(ddl.sql);
      assert.ok(m, 'CHECK на payment_status не знайдено — рівність множин недоведена');
      const allowed = m![1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
      const known = [...PAYMENT_STATUS_VALUES].sort();
      assert.deepStrictEqual(allowed, known,
        `колонка і словник розійшлися: база дозволяє [${allowed}], екран знає [${known}]`);
      console.log(`  ok  множини РІВНІ: [${allowed.join(', ')}]`);
    } else {
      // Postgres-прогін (`check:pg`) читає каталог інакше; там рівність
      // доводить `check-schema-drift`. Мовчати не можна — інакше зелень
      // означала б «звірено», а насправді означала б «не дивився».
      console.log('  (пропущено) не SQLite: рівність множин на Postgres тримає check-schema-drift');
    }
  });

  // ── 7. Жодного власного списку статусів поза словником ───────────────────
  //
  // Гейт вище звіряє базу зі словником, а не словник з його СПОЖИВАЧАМИ, і
  // саме через це «усі копії переведено» було неправдою: у дереві лишались
  // чотири власні списки, два з яких не знали `partial` (картка гостя і
  // вивантаження CSV показували сирий токен). Тому — статичне твердження про
  // вихідний код, як у `price-calendar.repo.check`.
  //
  // Форма словника впізнається за двома шаблонами: об'єктні ключі
  // (`unpaid: { … }`) і пункти списку (`value="unpaid"`, `value: 'unpaid'`).
  // Порівняння одного статусу в умові — не словник і не ловиться навмисно.
  const fs = await import('node:fs');
  const path = await import('node:path');

  /** Коментарі забілюються, а не вирізаються: номери рядків мають лишитись. */
  const withoutComments = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

  const DICT = 'src/modules/bookings/ui/payment-status.ts';
  // Дві свідомі копії, і кожна з причиною, а не з недогляду:
  const ALLOWED = new Map([
    // Носій каталогу перекладів. Екстрактор рядків дістає літерали лише через
    // МІСЦЕ РЕНДЕРУ в тому самому файлі, тож зі спільного модуля вони в
    // catalogue.json не потрапляють узагалі — а це «100 % покриття» при
    // українському слові на німецькому екрані. Список тут лишається навмисно
    // і звіряється зі словником нижче, тож розійтися не може.
    ['src/components/booking/BookingForm.tsx', 'носій каталогу перекладів, звіряється зі словником'],
    // Чужа тека (задача §2.6: файл, названий чужим, не редагується). Передано
    // у звіті рецензії 07.09 раунд 3, п. 2.2.
    ['src/app/app/(dashboard)/sites/[siteId]/_components/BookingsTab.tsx', 'чужа тека — передано у звіті'],
  ]);

  const STATUSES = ['unpaid', 'payment_requested', 'partial', 'prepaid', 'paid'];
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });

  const offenders: string[] = [];
  for (const file of walk('src')) {
    const rel = file.split(path.sep).join('/');
    if (rel === DICT || ALLOWED.has(rel) || rel.endsWith('.check.ts')) continue;
    const src = withoutComments(fs.readFileSync(file, 'utf8'));
    const keys = new Set(STATUSES.filter((v) => new RegExp(`(^|[\\s{,])${v}\\s*:`, 'm').test(src)));
    const options = new Set(STATUSES.filter((v) => new RegExp(`value\\s*[=:]\\s*['"\`]${v}['"\`]`).test(src)));
    const shape = keys.size >= 3 ? 'словник' : options.size >= 3 ? 'список пунктів' : null;
    if (shape) offenders.push(`${rel} — власний ${shape} статусів оплати (${[...(keys.size >= 3 ? keys : options)].join(', ')})`);
  }
  assert.deepStrictEqual(offenders, [],
    `власний список статусів оплати поза ${DICT}:\n  ${offenders.join('\n  ')}`);
  console.log(`  ok  власних списків статусів поза словником немає (2 свідомі винятки)`);

  // ── 8. Носій каталогу не має права розійтися зі словником ────────────────
  const carrier = fs.readFileSync('src/components/booking/BookingForm.tsx', 'utf8');
  const block = /const PAYMENT_STATUS_OPTIONS[^=]*=\s*\[([\s\S]*?)\];/.exec(carrier);
  assert.ok(block, 'у носія каталогу більше немає списку PAYMENT_STATUS_OPTIONS');
  const carried = [...block![1].matchAll(/value:\s*'([^']+)',\s*label:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(
    carried.map(([v]) => v), [...PAYMENT_STATUS_VALUES],
    'носій каталогу і словник мають різні НАБОРИ статусів');
  for (const [v, label] of carried) {
    assert.strictEqual(label, PAYMENT_STATUS_MAP[v as keyof typeof PAYMENT_STATUS_MAP].label,
      `носій каталогу називає '${v}' інакше, ніж словник — у перекладі опиниться слово, якого екран не показує`);
  }
  console.log('  ok  носій каталогу перекладів слово в слово збігається зі словником');

  console.log('payment-status: база і екран знають той самий набір; «частково» зберігається і фільтрується');
} finally {
  await cleanup();
}
