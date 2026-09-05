/**
 * Та сама ревізія, доставлена двічі, не створює другої броні.
 *
 *   node src/modules/channels/data/inbound-bookings.check.ts
 *
 * Це чекпоінт CP4 (`docs/research/NORTHSTAR.md` §4), і питання в ньому
 * поставлене так: «що станеться, якщо Channex доставить ту саму ревізію
 * двічі?». Відповідь має бути доказом, а не запевненням.
 *
 * Повторна доставка тут — буденність, не аварія. Вебхуки приходять не в тому
 * порядку, у якому сталися події (документація Channex каже це дослівно),
 * `ack` шлеться ПІСЛЯ коміту, тож процес, що впав між ними, побачить ту саму
 * ревізію ще раз. Так само зробить повтор мережі й кнопка «синхронізувати».
 *
 * Написано ДО реалізації і мало бути червоним (інваріант 24). Було: перша
 * версія `applyRevision()` робила `INSERT` на кожну ревізію — дві броні на
 * одного гостя, і побачив би це готель за одним столом сніданку на два
 * номери.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { applyRevision } = await import('./inbound-bookings.repo.ts');

const sql = getSql();
const ORG = '__cm_check__org';
const PROP = '__cm_check__prop';
const CAT = '__cm_check__cat';
const TYPE = '__cm_check__type';
const GUEST = '__cm_check__guest';
const CONN = '__cm_check__conn';
const TYPE2 = '__cm_check__type2';
const UNIT = '__cm_check__unit';
/** Другий орендар: один не доводить нічого. */
const OTHER = '__cm_check__other';

async function cleanup() {
  // Тенантні таблиці прибираються В КОНТЕКСТІ орендаря: під FORCE RLS
  // `DELETE … WHERE organization_id = ?` без `app.organization_id` мовчки
  // зачіпає нуль рядків, і наступний `DELETE FROM organizations` падає на
  // зовнішньому ключі. Не показувалось, бо `check:pg` у CI бігав
  // суперкористувачем, для якого політик не існує (INC-014).
  await runWithOrganization(ORG, async () => {
    await sql.run('DELETE FROM cm_inbound_bookings WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM booking_activity_log WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM reservations WHERE organization_id = ?', [ORG]);
    await sql.run("DELETE FROM units WHERE id LIKE '__cm_check__%'", []);
    await sql.run("DELETE FROM unit_types WHERE id LIKE '__cm_check__%'", []);
    await sql.run("DELETE FROM categories WHERE id LIKE '__cm_check__%'", []);
    await sql.run("DELETE FROM guests WHERE id LIKE '__cm_check__%'", []);
    await sql.run("DELETE FROM properties WHERE id LIKE '__cm_check__%'", []);
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id = ?', [OTHER]);
}

await cleanup();
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, 'CM', ORG]);
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [OTHER, 'CM2', OTHER]);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
      [PROP, ORG, 'CM', PROP]);
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)',
      [CAT, PROP, 'Rooms', 'room']);
    await sql.run('INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, ?, ?)',
      [TYPE, PROP, CAT, 'DZ', 'DZ']);
    // Другий тип і номер першого типу — для сцени про зміну ТИПУ з каналу
    // (Д9): без другого типу «тип змінився» і «тип той самий» невідрізнювані.
    await sql.run('INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, ?, ?)',
      [TYPE2, PROP, CAT, 'TW', 'TW']);
    await sql.run(
      `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, is_active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [UNIT, PROP, TYPE, CAT, '101', '101'],
    );
    await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
      [GUEST, ORG, 'Chan', 'Nel']);
    // `provider` називається ЯВНО: DEFAULT у схемі немає навмисно — імені
    // вендора в спільній схемі не буває (інваріант И1). Зʼєднання без
    // провайдера безглузде, тож база про це й питає.
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider,
                                   webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [CONN, ORG, PROP, 'probe', 'tok_check', 'sec_check'],
    );
    // Обидва типи змаплені: писач наявності шле лише змапленим (outbox.check).
    for (const [t, remote] of [[TYPE, 'remote-dz'], [TYPE2, 'remote-tw']]) {
      await sql.run(
        `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
         VALUES (?, ?, ?, 'unit_type', ?, '', 0, ?)`,
        [`${CONN}_m_${remote}`, ORG, CONN, t, remote],
      );
    }

    const rev = (over: Record<string, unknown> = {}) => ({
      remoteRevisionId: 'rev-1',
      remoteBookingId: 'bkg-1',
      status: 'new' as const,
      otaReservationCode: 'BDC-777',
      otaName: 'Booking.com',
      raw: { hello: 'world' },
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      unitTypeId: TYPE,
      adults: 2,
      children: 0,
      totalPrice: 300,
      currency: 'EUR',
      ...over,
    });

    const countReservations = async () =>
      Number(((await sql.row<any>(
        'SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?', [ORG])) as any).n);
    const countJournal = async () =>
      Number(((await sql.row<any>(
        'SELECT COUNT(*) AS n FROM cm_inbound_bookings WHERE organization_id = ?', [ORG])) as any).n);

    // ── CP4: та сама ревізія двічі ───────────────────────────────────────
    const first = await applyRevision(sql, CONN, rev());
    assert.strictEqual(first.result, 'applied', `перша ревізія: ${JSON.stringify(first)}`);
    assert.strictEqual(await countReservations(), 1, 'перша ревізія мала створити одну бронь');

    const again = await applyRevision(sql, CONN, rev());
    assert.strictEqual(again.result, 'duplicate',
      'повторна доставка тієї самої ревізії мала бути впізнана як дубль');
    assert.strictEqual(await countReservations(), 1,
      'повторна доставка створила ДРУГУ бронь — це два сніданки на одного гостя');
    assert.strictEqual(await countJournal(), 1, 'журнал теж не має двоїтись');
    console.log('  ok  та сама ревізія двічі → одна бронь, один рядок журналу');

    // Дубль однаково впізнається, навіть якщо решта полів приїхала іншою:
    // ключ — саме ідентифікатор ревізії, а не вміст.
    const noisy = await applyRevision(sql, CONN, rev({ totalPrice: 999, adults: 4 }));
    assert.strictEqual(noisy.result, 'duplicate',
      'ревізія з тим самим id, але іншим вмістом, мала лишитись дублем');
    assert.strictEqual(await countReservations(), 1);
    console.log('  ok  дубль упізнається за id ревізії, а не за вмістом');

    // ── Наступна ревізія ТІЄЇ САМОЇ броні — зміна, не нова бронь ─────────
    // Зміна несе нові дати, суму і гостя: ночей стає 4 (було 2), а гість
    // перейменований. Обидва — живе 03.09.2026 (Д8): картка після зміни з
    // каналу показувала старі «2 н.» на трьох ночах, бо `nights` — колонка,
    // і імʼя лишалось старим, бо гість не оновлювався.
    const modified = await applyRevision(sql, CONN, rev({
      remoteRevisionId: 'rev-2', status: 'modified', checkOut: '2026-10-14', totalPrice: 450,
      guestFirstName: 'Anna', guestLastName: 'Nova', guestEmail: 'anna@example.test',
    }));
    assert.strictEqual(modified.result, 'applied');
    assert.strictEqual(await countReservations(), 1,
      'зміна створила другу бронь замість того, щоб змінити наявну');
    assert.strictEqual(await countJournal(), 2, 'кожна ревізія лишає свій рядок журналу');
    assert.strictEqual(modified.result === 'applied' ? modified.created : true, false,
      'друга ревізія тієї самої броні не мала СТВОРЮВАТИ бронь');

    const after = await sql.row<any>(
      `SELECT r.check_out, r.total_price, r.nights, g.first_name, g.last_name, g.email
         FROM reservations r JOIN guests g ON g.id = r.guest_id
        WHERE r.organization_id = ?`, [ORG]) as any;
    assert.strictEqual(String(after.check_out).slice(0, 10), '2026-10-14',
      'зміна дат не доїхала до броні');
    assert.strictEqual(Number(after.total_price), 450, 'зміна суми не доїхала до броні');
    assert.strictEqual(Number(after.nights), 4,
      `ночі після зміни дат мали перерахуватись: 10.10 → 14.10 це 4, а колонка каже ${after.nights} (Д8)`);
    assert.deepStrictEqual([after.first_name, after.last_name, after.email], ['Anna', 'Nova', 'anna@example.test'],
      'гість із ревізії-зміни мав оновити картку гостя цієї броні (Д8)');
    console.log('  ok  наступна ревізія змінює ТУ САМУ бронь, а не створює нову');

    // ── Скасування ───────────────────────────────────────────────────────
    const cancelled = await applyRevision(sql, CONN, rev({
      remoteRevisionId: 'rev-3', status: 'cancelled',
    }));
    assert.strictEqual(cancelled.result, 'applied');
    assert.strictEqual(await countReservations(), 1, 'скасування не видаляє бронь, а міняє статус');
    const st = await sql.row<any>(
      'SELECT status FROM reservations WHERE organization_id = ?', [ORG]) as any;
    assert.strictEqual(st.status, 'cancelled', 'скасована ревізія не скасувала бронь');
    console.log('  ok  скасування міняє статус, а не стирає бронь');

    // ── Кожна ревізія лишає запис в історії броні (задача 1, 03.09.2026) ──
    //
    // Історія змін на картці — те, що рецепція читає щодня і що йде
    // скріншотом рецензенту: хто, коли, що змінив. Ревізія з каналу — теж
    // «хто»: назва OTA і код броні, а не «Система». Три ревізії вище — нова,
    // зміна, скасування — мусять лишити три записи, кожен зі своєю дією і
    // з кодом броні в тексті.
    {
      const rows = await sql.rows<any>(
        `SELECT action, details, user_name FROM booking_activity_log
          WHERE organization_id = ? AND reservation_id = (SELECT id FROM reservations WHERE organization_id = ? AND external_uid = 'BDC-777')
          ORDER BY created_at ASC, id ASC`,
        [ORG, ORG]) as any[];
      assert.deepStrictEqual(rows.map((r) => r.action), ['channel_created', 'channel_modified', 'channel_cancelled'],
        `три ревізії — три записи історії, а є: ${JSON.stringify(rows.map((r) => r.action))}`);
      for (const r of rows) {
        assert.ok(String(r.user_name).includes('Booking.com'), `автор запису — назва OTA, а не «${r.user_name}»`);
        assert.ok(String(r.details).includes('BDC-777'), `код броні в тексті запису: ${r.details}`);
      }
      assert.ok(/2026-10-12.*2026-10-14|12\.10.*14\.10/.test(rows[1].details),
        `запис про зміну називає, що змінилось (виїзд 12 → 14): ${rows[1].details}`);
      console.log('  ok  кожна ревізія з каналу лишає запис в історії броні: хто, що, з кодом');
    }

    // ── Бронь лягає БЕЗ номера (CP3) ─────────────────────────────────────
    const placed = await sql.row<any>(
      'SELECT unit_id, unit_type_id FROM reservations WHERE organization_id = ?', [ORG]) as any;
    assert.strictEqual(placed.unit_id, null,
      'канал не знає про кімнати — бронь мала лягти без призначеного номера');
    assert.strictEqual(placed.unit_type_id, TYPE, 'тип номера мав зберегтися');
    console.log('  ok  бронь із каналу лягає на ТИП номера, без кімнати');

    // ── Канал змінив ТИП номера броні, яка вже стоїть у кімнаті (Д9) ─────
    //
    // Живе 03.09.2026 (тест 11): Booking CRS перевів бронь із Twin на Double,
    // а в нас вона лишилась у кімнаті T2 типу Twin з `unit_type_id = Double`.
    // Наявність рахує зайнятою КІМНАТУ (Twin), а канал отримав координату
    // Double — Double у каналі не зменшився, Twin не було чим оновити.
    // Кімната старого типу не вміщає новий тип: бронь повертається у смугу
    // «Без номера» нового типу, а в чергу лягають ОБИДВА типи — старий
    // (кімната звільнилась) і новий (тип зайнятий).
    {
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      const fresh = await applyRevision(sql, CONN, rev({
        remoteRevisionId: 'rev-20', remoteBookingId: 'bkg-2', otaReservationCode: 'BDC-778',
        checkIn: '2026-11-03', checkOut: '2026-11-05',
      }));
      assert.strictEqual(fresh.result, 'applied');
      const id = (await sql.row<any>(
        'SELECT id FROM reservations WHERE organization_id = ? AND external_uid = ?', [ORG, 'BDC-778']) as any).id;
      // Рецепція поставила бронь у кімнату першого типу.
      await sql.run('UPDATE reservations SET unit_id = ? WHERE id = ?', [UNIT, id]);
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);

      const retyped = await applyRevision(sql, CONN, rev({
        remoteRevisionId: 'rev-21', remoteBookingId: 'bkg-2', otaReservationCode: 'BDC-778', status: 'modified',
        checkIn: '2026-11-03', checkOut: '2026-11-05', unitTypeId: TYPE2,
      }));
      assert.strictEqual(retyped.result, 'applied');
      const row = await sql.row<any>('SELECT unit_id, unit_type_id FROM reservations WHERE id = ?', [id]) as any;
      assert.strictEqual(String(row.unit_type_id), TYPE2, 'новий тип із ревізії не доїхав');
      assert.strictEqual(row.unit_id ?? null, null,
        'кімната СТАРОГО типу лишилась на броні НОВОГО типу: наявність рахує Twin, канал отримує Double');
      const noted = (await sql.rows<any>(
        "SELECT DISTINCT unit_type_id FROM cm_outbox WHERE organization_id = ? AND kind = 'availability' AND sent_at IS NULL",
        [ORG]) as any[]).map((r) => String(r.unit_type_id)).sort();
      assert.deepStrictEqual(noted, [TYPE, TYPE2].sort(),
        `у чергу мали лягти ОБИДВА типи — звільнена кімната і зайнятий тип, а лягли: ${noted.join(', ') || 'нічого'}`);
      console.log('  ok  зміна типу з каналу знімає кімнату старого типу і кладе в чергу обидва типи (Д9)');
      // Прибрати за собою: наступні сцени рахують брони й журнал ORG.
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      await sql.run("DELETE FROM cm_inbound_bookings WHERE organization_id = ? AND remote_booking_id = 'bkg-2'", [ORG]);
      await sql.run('DELETE FROM reservations WHERE id = ?', [id]);
    }

    // ── Дві кімнати різних типів: створити → дати → прибрати → скасувати ─
    //
    // К1: одна ревізія з кількома кімнатами — це БАТЬКІВСЬКА бронь і по
    // дочірній на кімнату. Кожна дочірня на свій тип і без номера (П9),
    // батьківська описує бронювання цілком.
    //
    // Фікстура не вироджена по трьох осях, про які сцена стверджує
    // (інваріант 26):
    //   • ДВА РІЗНІ типи номера — з одним «кожна на свій тип» і «обидві на
    //     перший» дали б однакову наявність;
    //   • РІЗНІ дати кімнат — з однаковими «проміжок групи» і «дати першої
    //     кімнати» невідрізнювані;
    //   • сума бронювання 555 при кімнатах 300 + 210 = 510, і діти 1 зверху
    //     при 0 + 0 у кімнатах — інакше «за ревізією» і «сума кімнат»
    //     давали б те саме число.
    //
    // Ключі кімнат тут іменовані (`ota_unique_id`, як дає Booking.com), тож
    // «прибрати другу» прибирає саме другу. Позиційний випадок — у
    // `pull-bookings.check.ts`, разом із ціною позиційного ключа.
    {
      const CODE = 'BDC-GRP';
      const groupRev = (over: Record<string, unknown> = {}, rooms?: unknown[]) => rev({
        remoteBookingId: 'bkg-grp', otaReservationCode: CODE,
        checkIn: '2026-10-10', checkOut: '2026-10-13',
        adults: 3, children: 1, totalPrice: 555,
        rooms: rooms ?? [
          { key: 'u:49', unitTypeId: TYPE, checkIn: '2026-10-10', checkOut: '2026-10-12', adults: 2, children: 0, amount: 300 },
          { key: 'u:50', unitTypeId: TYPE2, checkIn: '2026-10-10', checkOut: '2026-10-13', adults: 1, children: 0, amount: 210 },
        ],
        ...over,
      });
      const group = async () => {
        const parent = await sql.row<any>(
          'SELECT * FROM reservations WHERE organization_id = ? AND external_uid = ?', [ORG, CODE]) as any;
        const kids = await sql.rows<any>(
          'SELECT * FROM reservations WHERE parent_id = ? ORDER BY external_uid', [parent?.id]) as any[];
        return { parent, kids };
      };
      const noted = async () => (await sql.rows<any>(
        "SELECT DISTINCT unit_type_id FROM cm_outbox WHERE organization_id = ? AND kind = 'availability' AND sent_at IS NULL",
        [ORG]) as any[]).map((r) => String(r.unit_type_id)).sort();

      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);

      // 1. Створити.
      const made = await applyRevision(sql, CONN, groupRev({ remoteRevisionId: 'grp-1', status: 'new' }));
      assert.strictEqual(made.result, 'applied', `група не завелася: ${JSON.stringify(made)}`);
      {
        const { parent, kids } = await group();
        assert.ok(parent, 'батьківської броні групи немає — бронювання нікуди повісити');
        assert.strictEqual(kids.length, 2, `дочірніх мало бути дві, а є ${kids.length}`);
        // Батьківська — конверт бронювання: свого типу вона НЕ має, інакше
        // наявність відняла б три номери за дві кімнати (`unassignedByTypeDay`
        // рахує КОЖЕН рядок без номера, батьківський теж).
        assert.strictEqual(parent.unit_type_id ?? null, null,
          'батьківська бронь узяла тип номера — наявність відняла б зайвий номер за кожну групу');
        assert.strictEqual(parent.unit_id ?? null, null, 'канал не знає про кімнати (CP3)');
        assert.strictEqual(String(parent.check_in).slice(0, 10), '2026-10-10');
        assert.strictEqual(String(parent.check_out).slice(0, 10), '2026-10-13',
          'проміжок групи мав накрити ОБИДВІ кімнати, а взяв дати першої');
        assert.strictEqual(Number(parent.nights), 3, 'ночі батьківської рахуються з її проміжку');
        assert.strictEqual(Number(parent.total_price), 555,
          'сума батьківської — за РЕВІЗІЄЮ (555), а не сума кімнат (510)');
        assert.strictEqual(Number(parent.adults), 3, 'дорослі батьківської — за ревізією');
        assert.strictEqual(Number(parent.children), 1,
          'діти батьківської — за ревізією (1), а не сума кімнат (0)');
        assert.strictEqual(String(made.result === 'applied' ? made.reservationId : ''), String(parent.id),
          'журнал ревізії має вказувати на БАТЬКІВСЬКУ бронь групи');

        assert.deepStrictEqual(kids.map((k) => String(k.unit_type_id)), [TYPE, TYPE2],
          'дочірні мали лягти кожна на свій тип');
        assert.deepStrictEqual(kids.map((k) => k.unit_id ?? null), [null, null],
          'дочірня з каналу лягає без номера (П9)');
        assert.deepStrictEqual(kids.map((k) => String(k.external_uid)), [`${CODE}#u:49`, `${CODE}#u:50`],
          'дочірня має нести ключ своєї кімнати — інакше наступна редакція не впізнає її');
        assert.deepStrictEqual(kids.map((k) => String(k.check_out).slice(0, 10)), ['2026-10-12', '2026-10-13'],
          'дочірні мали зберегти ВЛАСНІ дати кімнат');
        assert.deepStrictEqual(kids.map((k) => Number(k.nights)), [2, 3], 'ночі дочірньої — з її дат');
        assert.deepStrictEqual(kids.map((k) => Number(k.total_price)), [300, 210],
          'сума дочірньої — сума її кімнати');
        assert.deepStrictEqual(kids.map((k) => Number(k.adults)), [2, 1], 'дорослі дочірньої — з її кімнати');
        assert.deepStrictEqual(kids.map((k) => String(k.guest_id)), [String(parent.guest_id), String(parent.guest_id)],
          'гість групи один: дві картки на одного гостя — дві історії замість однієї');
        assert.deepStrictEqual(kids.map((k) => String(k.status)), ['confirmed', 'confirmed']);
        assert.deepStrictEqual(await noted(), [TYPE, TYPE2].sort(),
          'наявність обох типів мала дізнатись про групу — інакше канал продасть номер, який уже зайнято');
      }
      console.log('  ok  дві кімнати → батьківська бронь + дві дочірні, кожна на свій тип (К1)');

      // 2. Змінити дати — на всю групу. Кімнати роз'їжджаються на РІЗНІ дати
      //    навмисно: з однаковими «проміжок групи» і «дати будь-якої кімнати»
      //    невідрізнювані, і крок 3 не мав би чому стискатись.
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      const moved = await applyRevision(sql, CONN, groupRev({ remoteRevisionId: 'grp-2', status: 'modified',
        checkIn: '2026-10-11', checkOut: '2026-10-15' }, [
        { key: 'u:49', unitTypeId: TYPE, checkIn: '2026-10-11', checkOut: '2026-10-13', adults: 2, children: 0, amount: 300 },
        { key: 'u:50', unitTypeId: TYPE2, checkIn: '2026-10-12', checkOut: '2026-10-15', adults: 1, children: 0, amount: 210 },
      ]));
      assert.strictEqual(moved.result, 'applied');
      {
        const { parent, kids } = await group();
        assert.strictEqual(kids.length, 2, 'зміна дат подвоїла групу');
        assert.strictEqual(String(parent.check_in).slice(0, 10), '2026-10-11', 'нові дати не доїхали до батьківської');
        assert.strictEqual(String(parent.check_out).slice(0, 10), '2026-10-15',
          'проміжок групи мав накрити найпізніший виїзд, а взяв виїзд першої кімнати');
        assert.strictEqual(Number(parent.nights), 4, 'ночі батьківської — з її проміжку');
        assert.deepStrictEqual(kids.map((k) => String(k.check_in).slice(0, 10)), ['2026-10-11', '2026-10-12'],
          'зміна дат мала застосуватись до ВСІХ кімнат групи, кожній свої');
        assert.deepStrictEqual(kids.map((k) => Number(k.nights)), [2, 3], 'ночі дочірніх перераховані з нових дат');
        assert.deepStrictEqual(await noted(), [TYPE, TYPE2].sort(),
          'обидва типи мали дізнатись про перенесені ночі');
      }
      console.log('  ok  зміна дат застосовується до всієї групи, кожній кімнаті свої');

      // 3. Прибрати ПЕРШУ кімнату. Дочірня СКАСОВУЄТЬСЯ, а не зникає: вона
      //    була, і в звіті за минулий місяць має лишитись — так само як
      //    скасована одинична бронь.
      //
      //    Саме першу, а не другу, і це вісь усього кроку (інваріант 26).
      //    Прибрана друга виглядає однаково для двох різних реалізацій: та,
      //    що впізнає кімнату КЛЮЧЕМ, і та, що бере її ПОЗИЦІЄЮ, дадуть один
      //    результат, бо кімната, яка лишилась, і так перша. Прибрана перша
      //    їх розводить: за ключем скасується `#u:49` і виживе `#u:50` зі
      //    своїм типом; за позицією єдина кімната ляже в рядок `#u:49`,
      //    перепише йому тип і скасує `#u:50` — тобто в базі лишиться жива
      //    бронь із чужим ключем.
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      const shrunk = await applyRevision(sql, CONN, groupRev({ remoteRevisionId: 'grp-3', status: 'modified',
        checkIn: '2026-10-12', checkOut: '2026-10-15', adults: 1, children: 0, totalPrice: 230 }, [
        { key: 'u:50', unitTypeId: TYPE2, checkIn: '2026-10-12', checkOut: '2026-10-15', adults: 1, children: 0, amount: 210 },
      ]));
      assert.strictEqual(shrunk.result, 'applied');
      {
        const { parent, kids } = await group();
        assert.strictEqual(kids.length, 2, 'дочірня зникла з бази — скасування не стирає бронь');
        assert.deepStrictEqual(kids.map((k) => String(k.external_uid)), [`${CODE}#u:49`, `${CODE}#u:50`],
          'ключі дочірніх не мали мінятись від зникнення кімнати');
        assert.deepStrictEqual(kids.map((k) => String(k.status)), ['cancelled', 'confirmed'],
          'скасувалась не та кімната: прибрали ПЕРШУ, отже жити має #u:50 — ключ кімнати на те й потрібен');
        assert.strictEqual(String(kids[1].unit_type_id), TYPE2,
          'кімната, що лишилась, мала зберегти СВІЙ тип');
        assert.strictEqual(String(kids[0].unit_type_id), TYPE,
          'скасованій дочірній переписали тип — її ночі звільнились би не з того типу');
        assert.strictEqual(String(parent.status), 'confirmed', 'група ще жива — скасувалась лише одна кімната');
        assert.strictEqual(String(parent.check_in).slice(0, 10), '2026-10-12',
          'проміжок групи мав стиснутись до кімнат, які лишились');
        assert.strictEqual(String(parent.check_out).slice(0, 10), '2026-10-15');
        assert.deepStrictEqual(await noted(), [TYPE, TYPE2].sort(),
          'звільнені ночі прибраної кімнати мали поїхати в канал — інакше номер лишиться непроданим');
      }
      console.log('  ok  прибрана кімната скасовує СВОЮ дочірню за ключем і звільняє її ночі');

      // 4. Скасувати — усю групу.
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      const gone = await applyRevision(sql, CONN, groupRev({ remoteRevisionId: 'grp-4', status: 'cancelled' }));
      assert.strictEqual(gone.result, 'applied');
      {
        const { parent, kids } = await group();
        assert.strictEqual(String(parent.status), 'cancelled', 'скасування не дійшло до батьківської');
        assert.deepStrictEqual(kids.map((k) => String(k.status)), ['cancelled', 'cancelled'],
          'дочірні лишились активними після скасування бронювання — номери стояли б зайнятими');
        assert.deepStrictEqual(await noted(), [TYPE2].sort(),
          'звільнені ночі живої дочірньої мали поїхати в канал — і саме її типу');
      }
      console.log('  ok  скасування ревізії скасовує всю групу');

      // Історія — на батьківській, по запису на ревізію: рецепція читає групу
      // в одному місці, а не збирає з чотирьох карток.
      {
        const parentId = (await group()).parent.id;
        const rows = await sql.rows<any>(
          `SELECT action FROM booking_activity_log
            WHERE organization_id = ? AND reservation_id = ? ORDER BY created_at ASC, id ASC`,
          [ORG, parentId]) as any[];
        assert.deepStrictEqual(rows.map((r) => r.action),
          ['channel_created', 'channel_modified', 'channel_modified', 'channel_cancelled'],
          `чотири ревізії групи — чотири записи історії на батьківській, а є: ${JSON.stringify(rows.map((r) => r.action))}`);
        console.log('  ok  історія групи пишеться на батьківській броні');
      }

      // Прибрати за собою: наступні сцени рахують броні й журнал ORG.
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      await sql.run("DELETE FROM booking_activity_log WHERE organization_id = ? AND reservation_id IN (SELECT id FROM reservations WHERE organization_id = ? AND (external_uid = ? OR external_uid LIKE ?))",
        [ORG, ORG, CODE, `${CODE}#%`]);
      await sql.run("DELETE FROM cm_inbound_bookings WHERE organization_id = ? AND remote_booking_id = 'bkg-grp'", [ORG]);
      await sql.run('DELETE FROM reservations WHERE organization_id = ? AND parent_id IS NOT NULL AND external_uid LIKE ?', [ORG, `${CODE}#%`]);
      await sql.run('DELETE FROM reservations WHERE organization_id = ? AND external_uid = ?', [ORG, CODE]);
    }

    // ── Неіснуюче зʼєднання ──────────────────────────────────────────────
    const nowhere = await applyRevision(sql, '__no_such_connection__', rev({ remoteRevisionId: 'rev-9' }));
    assert.strictEqual(nowhere.result, 'refused',
      'ревізія на неіснуюче зʼєднання мала бути відхилена, а не створити бронь нізвідки');
    assert.strictEqual(await countReservations(), 1);
    console.log('  ok  ревізія без зʼєднання відмовляє, а не вигадує бронь');
  });

  // ── ЧУЖЕ зʼєднання ─────────────────────────────────────────────────────
  //
  // Це не те саме, що неіснуюче, і саме тут ховається помилка. `id`
  // зʼєднання приходить іззовні — з URL вебхука, з рядка черги, з аргументу
  // крона, — тож запит `WHERE id = ?` без орендаря на Postgres рятує
  // політика, а на SQLite не рятує НІЩО. SQLite стоїть у кожного розробника,
  // під `npm run dev` і в CI: «локально працює» тут доводить рівно
  // протилежне тому, що здається. Клас INC-010.
  //
  // Ціна: бронь чужого готелю лягає в НАШУ організацію — з іменем гостя,
  // сумою і датами.
  await runWithOrganization(OTHER, async () => {
    const trespass = await applyRevision(sql, CONN, {
      remoteRevisionId: 'rev-trespass',
      remoteBookingId: 'bkg-trespass',
      status: 'new',
      raw: {},
      checkIn: '2026-11-01',
      checkOut: '2026-11-03',
      unitTypeId: TYPE,
      adults: 2,
      totalPrice: 100,
      currency: 'EUR',
    });
    assert.strictEqual(trespass.result, 'refused',
      'чужий орендар застосував ревізію на НАШЕ зʼєднання — бронь сусіда лягла б до нас');
  });

  await runWithOrganization(ORG, async () => {
    const n = Number(((await sql.row<any>(
      'SELECT COUNT(*) AS n FROM cm_inbound_bookings WHERE organization_id = ?', [ORG])) as any).n);
    assert.strictEqual(n, 3, 'чужий орендар таки дописав рядок у наш журнал');
    console.log('  ok  ревізія на ЧУЖЕ зʼєднання відмовляє на обох двигунах');
  });
} finally {
  await cleanup();
}

console.log('inbound: ревізія стає бронню рівно один раз');
