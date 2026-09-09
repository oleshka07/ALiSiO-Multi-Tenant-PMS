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
// Наявність читається ТИМ САМИМ джерелом, що годує канал (И3): твердження
// «група займає рівно свої кімнати» має спиратись на те, що побачить батчер,
// а не на власний підрахунок рядків у сцені.
const { availabilityByDay } = await import('@properties');

const sql = getSql();
const ORG = '__cm_check__org';
const PROP = '__cm_check__prop';
const CAT = '__cm_check__cat';
const TYPE = '__cm_check__type';
const GUEST = '__cm_check__guest';
const CONN = '__cm_check__conn';
const TYPE2 = '__cm_check__type2';
const UNIT = '__cm_check__unit';
/**
 * Фонд, на якому читається наявність: ДВА номери першого типу й ОДИН другого.
 *
 * Порівну було б виродженою фікстурою (інваріант 26): «зайнято по типах» і
 * «зайнято всього, поділене навпіл» дали б те саме число, і реалізація, яка
 * рахує групу не тим типом, лишилась би зеленою.
 */
const UNIT2 = '__cm_check__unit2';
const UNIT3 = '__cm_check__unit3';
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
    // Те, що ВИСИТЬ на рядках групи, — перед самими рядками, і саме тому, що
    // прибирання тут уже падало: `reservation_guests.sub_booking_id` — ключ
    // без `ON DELETE`, тож гість, прописаний сценою 2e, робив `DELETE`
    // неможливим, і НАСТУПНИЙ прогін падав у прибиранні, тобто показував
    // «заведення зламане» замість «сцена не пройшла». Це той самий клас, що
    // в `provisioning-timezone.check`: сцена мусить прибирати все, що
    // створює, інакше її червоність читається як чужа поломка.
    await sql.run(
      `DELETE FROM reservation_line_items
        WHERE sub_booking_id IN (SELECT id FROM reservation_sub_bookings
          WHERE reservation_id IN (SELECT id FROM reservations WHERE organization_id = ?))`, [ORG]);
    await sql.run(
      `UPDATE reservation_guests SET sub_booking_id = NULL
        WHERE reservation_id IN (SELECT id FROM reservations WHERE organization_id = ?)`, [ORG]);
    await sql.run(
      `DELETE FROM reservation_guests
        WHERE reservation_id IN (SELECT id FROM reservations WHERE organization_id = ?)`, [ORG]);
    // Рядки групи — ПЕРЕД бронями: орендар у них не колонкою, а через
    // `reservation_id`, тож після видалення броней політика їх уже не бачить
    // і вони лишились би назавжди.
    await sql.run(
      `DELETE FROM reservation_sub_bookings
        WHERE reservation_id IN (SELECT id FROM reservations WHERE organization_id = ?)`, [ORG]);
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
    for (const [id, type, name] of [[UNIT, TYPE, '101'], [UNIT2, TYPE, '102'], [UNIT3, TYPE2, '201']]) {
      await sql.run(
        `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, is_active)
         VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
        [id, PROP, type, CAT, name, name],
      );
    }
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
    // ── Дві кімнати різних типів: створити → змінити → прибрати ПЕРШУ → скасувати ─
    //
    // К4 у рідній формі групи (рецензія 07.09). Група в цьому продукті — це не
    // «конверт і кімнати під ним»: майстер САМ Є кімнатою №1 (свій тип, свої
    // дати, своя сума), кімнати 2..n — дочірні броні з `parent_id`, і на кожну
    // кімнату є рядок `reservation_sub_bookings` — саме його читають фоліо,
    // картка і аркуші дня.
    //
    // Конверт (батьківська без типу з сумарними гостями) виглядав правильним і
    // ламав читачів мовчки: Zimmerliste рахував гостей двічі, турзбір — двічі,
    // календар малював три плашки на дві кімнати.
    //
    // Фікстура не вироджена по осях, про які сцена стверджує (інваріант 26):
    //   • ДВА РІЗНІ типи номера — з одним «кожна кімната на свій тип» і
    //     «обидві на перший» дали б однакову наявність;
    //   • РІЗНІ дати кімнат — з однаковими «дати майстра» і «дати кімнати №2»
    //     невідрізнювані;
    //   • бронювання цілком — 555 при кімнатах 300 + 210 = 510, троє дорослих
    //     при 2 + 1 і одна дитина при 0 + 0: сума бронювання, що заповзла в
    //     рядок майстра, арифметично видна;
    //   • фонд ДВА номери першого типу й ОДИН другого — «зайнято по типах» не
    //     збігається з «зайнято всього, поділене навпіл».
    //
    // Ключі кімнат тут іменовані (`ota_unique_id`, як дає Booking.com), тож
    // «прибрати першу» прибирає саме першу. Позиційний випадок — у
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

      let groupId = '';
      const group = async () => {
        const parent = await sql.row<any>('SELECT * FROM reservations WHERE id = ?', [groupId]) as any;
        const kids = await sql.rows<any>(
          'SELECT * FROM reservations WHERE parent_id = ? ORDER BY external_uid', [groupId]) as any[];
        const subs = await sql.rows<any>(
          `SELECT * FROM reservation_sub_bookings WHERE reservation_id = ?
            ORDER BY sort_order, created_at`, [groupId]) as any[];
        return { parent, kids, subs };
      };
      const noted = async () => (await sql.rows<any>(
        "SELECT DISTINCT unit_type_id FROM cm_outbox WHERE organization_id = ? AND kind = 'availability' AND sent_at IS NULL",
        [ORG]) as any[]).map((r) => String(r.unit_type_id)).sort();

      /**
       * Скільки номерів обʼєкта зайнято тієї ночі — очима того, хто годує канал.
       *
       * Не підрахунок рядків: рахує `availabilityByDay()`, і рівно так само
       * порахує батчер ARI. Конверт із типом дав би тут на одиницю більше, ніж
       * кімнат у бронюванні, — і канал отримав би на одиницю менше вільних.
       */
      const FUND: Array<[string, number]> = [[TYPE, 2], [TYPE2, 1]];
      const busyOn = async (night: string) => {
        const next = new Date(`${night}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        const byDay = await availabilityByDay(PROP, night, next.toISOString().slice(0, 10));
        let busy = 0;
        for (const [typeId, units] of FUND) {
          busy += units - Number(byDay.get(typeId)?.get(night) ?? units);
        }
        return busy;
      };

      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);

      // 1. Створити.
      const made = await applyRevision(sql, CONN, groupRev({ remoteRevisionId: 'grp-1', status: 'new' }));
      assert.strictEqual(made.result, 'applied', `група не завелася: ${JSON.stringify(made)}`);
      groupId = String(made.result === 'applied' ? made.reservationId : '');
      {
        const { parent, kids, subs } = await group();
        assert.ok(parent, 'майстра групи немає — бронювання нікуди повісити');
        assert.strictEqual(kids.length, 1,
          `дві кімнати — це майстер (кімната №1) і ОДНА дочірня, а дочірніх ${kids.length}`);

        // Майстер — кімната №1, а не конверт над нею.
        assert.strictEqual(String(parent.unit_type_id), TYPE,
          'майстер лишився без типу — це конверт: список не покаже типу, а PATCH дозволить поставити його в номер');
        assert.strictEqual(parent.unit_id ?? null, null, 'канал не знає про кімнати (CP3)');
        assert.strictEqual(String(parent.check_in).slice(0, 10), '2026-10-10');
        assert.strictEqual(String(parent.check_out).slice(0, 10), '2026-10-12',
          'дати майстра — це дати КІМНАТИ №1, а не проміжок усього бронювання');
        assert.strictEqual(Number(parent.nights), 2, 'ночі майстра — з дат його кімнати');
        assert.strictEqual(Number(parent.total_price), 300,
          'у рядок майстра заповзла сума бронювання (555) замість суми його кімнати (300) — фоліо порахує чуже');
        assert.strictEqual(Number(parent.adults), 2,
          'дорослі майстра — його кімнати (2), а не бронювання (3): інакше Zimmerliste рахує гостей двічі');
        assert.strictEqual(Number(parent.children), 0,
          'діти майстра — його кімнати (0), а не бронювання (1): турзбір порахує зайву особу');
        assert.strictEqual(String(parent.external_uid), `${CODE}#u:49`,
          'майстер має нести ключ СВОЄЇ кімнати — інакше при зникненні кімнати №1 нема за чим упізнати, що він тримав');

        assert.strictEqual(String(kids[0].unit_type_id), TYPE2, 'дочірня мала лягти на свій тип');
        assert.strictEqual(kids[0].unit_id ?? null, null, 'дочірня з каналу лягає без номера (П9)');
        assert.strictEqual(String(kids[0].external_uid), `${CODE}#u:50`, 'дочірня несе ключ своєї кімнати');
        assert.strictEqual(String(kids[0].check_out).slice(0, 10), '2026-10-13', 'дочірня має ВЛАСНІ дати кімнати');
        assert.strictEqual(Number(kids[0].nights), 3, 'ночі дочірньої — з її дат');
        assert.strictEqual(Number(kids[0].total_price), 210, 'сума дочірньої — сума її кімнати');
        assert.strictEqual(Number(kids[0].adults), 1, 'дорослі дочірньої — з її кімнати');
        assert.strictEqual(String(kids[0].guest_id), String(parent.guest_id),
          'гість групи один: дві картки на одного гостя — дві історії замість однієї');
        assert.strictEqual(String(kids[0].status), 'confirmed');

        // Рядки групи: по одному на кімнату. Кімната майстра — рядок без
        // дочірньої броні (`child_reservation_id IS NULL`), як його заводить
        // рецепція; кімната 2 — рядок зі своєю дочірньою.
        assert.strictEqual(subs.length, 2,
          `на кожну кімнату має бути рядок reservation_sub_bookings, а їх ${subs.length} — картка групи покаже порожньо`);
        assert.strictEqual(subs[0].child_reservation_id ?? null, null,
          'перший рядок групи — кімната самого майстра, у неї немає окремої броні');
        assert.strictEqual(String(subs[1].child_reservation_id), String(kids[0].id),
          'другий рядок групи має вказувати на дочірню бронь кімнати 2');
        assert.deepStrictEqual(subs.map((s) => String(s.label)), ['DZ', 'TW'],
          'назва рядка групи — тип номера кімнати: інакше в картці два рядки без імен');
        assert.deepStrictEqual(subs.map((s) => Number(s.adults)), [2, 1], 'гості рядка — гості його кімнати');
        assert.deepStrictEqual(subs.map((s) => Number(s.subtotal)), [300, 210], 'сума рядка — сума його кімнати');

        assert.strictEqual(await busyOn('2026-10-10'), 2,
          'у ніч, коли зайняті обидві кімнати, наявність має показати рівно два зайняті номери');
        assert.strictEqual(await busyOn('2026-10-12'), 1,
          'у ніч, коли кімната №1 уже виїхала, зайнятою лишається одна');
        assert.deepStrictEqual(await noted(), [TYPE, TYPE2].sort(),
          'наявність обох типів мала дізнатись про групу — інакше канал продасть номер, який уже зайнято');
      }
      console.log('  ok  дві кімнати → майстер (кімната №1) + дочірня, і рядок групи на кожну (К4)');

      // 2. Змінити дати — на всю групу. Кімнати роз'їжджаються на РІЗНІ дати
      //    навмисно: з однаковими «дати майстра» і «дати кімнати 2» крок 3 не
      //    мав би чому зсунутись.
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      const moved = await applyRevision(sql, CONN, groupRev({ remoteRevisionId: 'grp-2', status: 'modified',
        checkIn: '2026-10-11', checkOut: '2026-10-15' }, [
        { key: 'u:49', unitTypeId: TYPE, checkIn: '2026-10-11', checkOut: '2026-10-13', adults: 2, children: 0, amount: 320 },
        { key: 'u:50', unitTypeId: TYPE2, checkIn: '2026-10-12', checkOut: '2026-10-15', adults: 1, children: 0, amount: 210 },
      ]));
      assert.strictEqual(moved.result, 'applied');
      {
        const { parent, kids, subs } = await group();
        assert.strictEqual(kids.length, 1, 'зміна дат подвоїла групу');
        assert.strictEqual(String(parent.check_in).slice(0, 10), '2026-10-11', 'нові дати кімнати №1 не доїхали до майстра');
        assert.strictEqual(String(parent.check_out).slice(0, 10), '2026-10-13',
          'майстер узяв найпізніший виїзд бронювання замість виїзду СВОЄЇ кімнати');
        assert.strictEqual(Number(parent.nights), 2, 'ночі майстра перераховані з нових дат його кімнати');
        assert.strictEqual(Number(parent.total_price), 320, 'нова сума кімнати №1 не доїхала до майстра');
        assert.strictEqual(String(kids[0].check_in).slice(0, 10), '2026-10-12',
          'зміна дат мала застосуватись до ВСІХ кімнат групи, кожній свої');
        assert.strictEqual(Number(kids[0].nights), 3, 'ночі дочірньої перераховані з нових дат');
        assert.deepStrictEqual(subs.map((s) => Number(s.subtotal)), [320, 210],
          'рядки групи мали піти за кімнатами — інакше фоліо лишиться на старій сумі');

        assert.strictEqual(await busyOn('2026-10-12'), 2, 'у спільну ніч зайнято дві кімнати');
        assert.strictEqual(await busyOn('2026-10-11'), 1, 'до заїзду кімнати 2 зайнята одна');
        assert.strictEqual(await busyOn('2026-10-10'), 0, 'ніч, з якої група поїхала, мала звільнитись цілком');
        assert.deepStrictEqual(await noted(), [TYPE, TYPE2].sort(),
          'обидва типи мали дізнатись про перенесені ночі');
      }
      console.log('  ok  зміна дат застосовується до всієї групи, кожній кімнаті свої');

      // 2b. Та сама група, але кімнати приїхали в ІНШОМУ ПОРЯДКУ.
      //
      //     Вісь, без якої вся сцена вироджена (інваріант 26): доки кімната
      //     майстра стоїть першою, «майстер тримає СВОЮ кімнату» і «майстер
      //     бере кімнату з позиції 0» дають однакову базу. Порядок у ревізії
      //     наш не тримає нічим — `booking_room_id` між ревізіями не
      //     зберігається (вимір Н3), — і реалізація по позиції переклала б
      //     кімнати між рядками: номер, який рецепція призначила під TW,
      //     опинився б під DZ, а гості й сума помінялися б місцями беззвучно.
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      const reordered = await applyRevision(sql, CONN, groupRev({ remoteRevisionId: 'grp-2b', status: 'modified' }, [
        { key: 'u:50', unitTypeId: TYPE2, checkIn: '2026-10-12', checkOut: '2026-10-15', adults: 1, children: 0, amount: 210 },
        { key: 'u:49', unitTypeId: TYPE, checkIn: '2026-10-11', checkOut: '2026-10-13', adults: 2, children: 0, amount: 320 },
      ]));
      assert.strictEqual(reordered.result, 'applied');
      {
        const { parent, kids, subs } = await group();
        assert.strictEqual(String(parent.external_uid), `${CODE}#u:49`,
          'майстер перескочив на кімнату з позиції 0 — кімнати помінялися рядками від самого лише порядку в ревізії');
        assert.strictEqual(String(parent.unit_type_id), TYPE, 'майстер мав лишитись на СВОЇЙ кімнаті та її типі');
        assert.strictEqual(Number(parent.total_price), 320, 'сума майстра — його ж кімнати');
        assert.strictEqual(kids.length, 1, 'перестановка кімнат завела зайву дочірню');
        assert.strictEqual(String(kids[0].external_uid), `${CODE}#u:50`, 'дочірня мала лишитись своєю кімнатою');
        assert.strictEqual(String(kids[0].unit_type_id), TYPE2);
        assert.deepStrictEqual(subs.map((s) => String(s.label)), ['DZ', 'TW'],
          'рядки групи пішли за порядком ревізії, а не за кімнатами');
        assert.strictEqual(await busyOn('2026-10-12'), 2, 'перестановка кімнат не міняє зайнятості');
      }
      console.log('  ok  порядок кімнат у ревізії не пересуває кімнати між рядками — упізнає ключ');

      // 2c. Прибрати кімнату 2 і повернути її під тим самим ключем.
      //
      //     Кімната, якої в редакції немає, СКАСОВУЄТЬСЯ, а не стирається: вона
      //     була, гість про неї знає, у звіті за минулий місяць має лишитись.
      //     Різницю видно лише тут: у кроці 3 зникає кімната майстра, а її
      //     шлях інший (обмін рядками), тож «скасувати» і «видалити» там
      //     невідрізнювані. Повернення тим самим ключем оживляє ТОЙ САМИЙ
      //     рядок — інакше історія кімнати починається з нуля щоразу.
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      const kidIdBefore = String((await group()).kids[0].id);
      const dropped = await applyRevision(sql, CONN, groupRev({ remoteRevisionId: 'grp-2c', status: 'modified' }, [
        { key: 'u:49', unitTypeId: TYPE, checkIn: '2026-10-11', checkOut: '2026-10-13', adults: 2, children: 0, amount: 320 },
      ]));
      assert.strictEqual(dropped.result, 'applied');
      {
        const { parent, kids, subs } = await group();
        assert.strictEqual(kids.length, 1,
          'прибрану кімнату СТЕРЛИ, а не скасували — бронь, яка була, зникла зі звітів за минулий місяць');
        assert.strictEqual(String(kids[0].id), kidIdBefore, 'скасування мало лишити ТОЙ САМИЙ рядок');
        assert.strictEqual(String(kids[0].status), 'cancelled', 'кімната, якої немає в редакції, мала скасуватись');
        assert.strictEqual(String(kids[0].unit_type_id), TYPE2, 'скасованій кімнаті переписали тип');
        assert.strictEqual(String(parent.status), 'confirmed', 'майстра зачепило скасування чужої кімнати');
        assert.strictEqual(subs.length, 1, 'рядок групи лишився на кімнаті, за яку вже не беруть грошей');
        assert.strictEqual(await busyOn('2026-10-12'), 1, 'зайнятою лишається кімната майстра');
        assert.strictEqual(await busyOn('2026-10-14'), 0, 'ночі прибраної кімнати мали звільнитись');
      }
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      const back = await applyRevision(sql, CONN, groupRev({ remoteRevisionId: 'grp-2d', status: 'modified' }, [
        { key: 'u:49', unitTypeId: TYPE, checkIn: '2026-10-11', checkOut: '2026-10-13', adults: 2, children: 0, amount: 320 },
        { key: 'u:50', unitTypeId: TYPE2, checkIn: '2026-10-12', checkOut: '2026-10-15', adults: 1, children: 0, amount: 210 },
      ]));
      assert.strictEqual(back.result, 'applied');
      {
        const { kids, subs } = await group();
        assert.strictEqual(kids.length, 1, 'кімната, що повернулась, завела ДРУГИЙ рядок замість того, що вже був');
        assert.strictEqual(String(kids[0].id), kidIdBefore, 'кімната під тим самим ключем мала ожити тим самим рядком');
        assert.strictEqual(String(kids[0].status), 'confirmed', 'кімната повернулась, а лишилась скасованою');
        assert.strictEqual(subs.length, 2, 'рядок групи не повернувся разом із кімнатою');
        assert.strictEqual(await busyOn('2026-10-14'), 1, 'ночі кімнати, що повернулась, мали знову зайнятись');
      }
      console.log('  ok  прибрана кімната скасовується тим самим рядком і оживає під своїм ключем');

      // 2e. Кімната, на якій ВЖЕ ХТОСЬ Є: гість і позиція фоліо (Б2).
      //
      //     Тут жив нескінченний цикл. `reservation_guests.sub_booking_id` —
      //     зовнішній ключ БЕЗ `ON DELETE`, тож рядок групи, на якому
      //     прописаний гість, не видалявся взагалі:
      //
      //       ERROR: update or delete on table "reservation_sub_bookings"
      //              violates foreign key constraint
      //              "fk_reservation_guests_sub_booking_id_1"
      //
      //     Виняток валив `apply`, стрічка писала `apply_failed:` і йшла далі,
      //     `ack` не виконувався НІКОЛИ — і та сама ревізія поверталась кожним
      //     проходом, доки готель не отримував `non_acked_booking` без кінця.
      //     Сценарій буденний: рецепція прописала гостя на кімнату 2, канал
      //     цю кімнату прибрав (рецензія раунду 21, Б2).
      //
      //     Вісь сцени — НЕ «гість є / гостя немає», а «на рядку є ГРОШІ»:
      //     позиції фоліо мають `ON DELETE CASCADE`, тобто зникли б мовчки
      //     разом із рядком, а чи можна стирати виставлені позиції з волі
      //     каналу — питання власника, і поки воно відкрите, такий рядок
      //     ЛИШАЄТЬСЯ. Тому дві кімнати з різними відповідями (§26): у
      //     першої лише гість — рядок знімається; у другої ще й позиція —
      //     рядок лишається, і жодного винятку.
      {
        const twoRooms = [
          { key: 'u:49', unitTypeId: TYPE, checkIn: '2026-10-11', checkOut: '2026-10-13', adults: 2, children: 0, amount: 320 },
          { key: 'u:50', unitTypeId: TYPE2, checkIn: '2026-10-12', checkOut: '2026-10-15', adults: 1, children: 0, amount: 210 },
        ];
        const subOf = async (key: string) => {
          const kid = (await group()).kids.find((k: any) => String(k.external_uid).endsWith(`#${key}`));
          const all = (await group()).subs;
          return all.find((x: any) => String(x.child_reservation_id ?? '') === String(kid?.id ?? '')) ?? all[0];
        };

        // Гість на кімнаті 2 — і більше нічого.
        const guestOnly = await subOf('u:50');
        await sql.run(
          `INSERT INTO reservation_guests (id, reservation_id, first_name, last_name, sub_booking_id)
           VALUES (?, ?, ?, ?, ?)`,
          ['__cm_check__g1', groupId, 'Прописаний', 'Гість', String(guestOnly.id)]);

        await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
        const dropGuestRoom = await applyRevision(sql, CONN, groupRev(
          { remoteRevisionId: 'grp-2e', status: 'modified' }, [twoRooms[0]]));
        assert.strictEqual(dropGuestRoom.result, 'applied',
          'ревізія не застосувалась через гостя на прибраній кімнаті — саме тут ack не виконувався НІКОЛИ');
        {
          const { subs } = await group();
          assert.strictEqual(subs.length, 1,
            'рядок без позицій мав зникнути — гість лише відʼєднується, він не тримає рядок');
          const guest = await sql.row<any>(
            'SELECT sub_booking_id FROM reservation_guests WHERE id = ?', ['__cm_check__g1']) as any;
          assert.ok(guest, 'гостя СТЕРЛИ разом із рядком — він лишається на броні, просто без кімнати');
          assert.strictEqual(guest.sub_booking_id ?? null, null,
            'гість лишився прописаним на кімнату, якої вже немає');
        }

        // Та сама кімната повертається — і цього разу на ній ГРОШІ.
        await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
        const returned = await applyRevision(sql, CONN, groupRev(
          { remoteRevisionId: 'grp-2f', status: 'modified' }, twoRooms));
        assert.strictEqual(returned.result, 'applied');
        const charged = await subOf('u:50');
        await sql.run(
          `INSERT INTO reservation_line_items (id, sub_booking_id, description, quantity, unit_price, total)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['__cm_check__li1', String(charged.id), 'Ніч', 1, 210, 210]);

        await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
        const dropCharged = await applyRevision(sql, CONN, groupRev(
          { remoteRevisionId: 'grp-2g', status: 'modified' }, [twoRooms[0]]));
        assert.strictEqual(dropCharged.result, 'applied',
          'ревізія не застосувалась через позиції фоліо на прибраній кімнаті');
        {
          const { subs } = await group();
          assert.strictEqual(subs.length, 2,
            'рядок із виставленими позиціями СТЕРЛИ — канал не має права мовчки знімати гроші з фоліо');
          const item = await sql.row<any>(
            'SELECT id FROM reservation_line_items WHERE id = ?', ['__cm_check__li1']) as any;
          assert.ok(item, 'позицію фоліо стерто каскадом — саме цього рішення власник ще не ухвалював');
        }

        // Прибрати за собою: наступний крок рахує рядки групи.
        await sql.run('DELETE FROM reservation_line_items WHERE id = ?', ['__cm_check__li1']);
        await sql.run('DELETE FROM reservation_guests WHERE id = ?', ['__cm_check__g1']);
        await sql.run('DELETE FROM reservation_sub_bookings WHERE id = ?', [String(charged.id)]);
        await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
        await applyRevision(sql, CONN, groupRev(
          { remoteRevisionId: 'grp-2h', status: 'modified' }, twoRooms));
      }
      console.log('  ok  кімната з гостем знімається, кімната з позиціями фоліо лишається — і ревізія проходить (Б2)');

      // 3. Прибрати ПЕРШУ кімнату — ту, яку тримає майстер.
      //
      //    Це вісь усього кроку. Конверт просто скасував би «свою» дочірню;
      //    рідна форма мусить ПЕРЕЙНЯТИ кімнату №2 в майстра (rekey), бо
      //    майстер — це сама бронь: скасований майстер із живою дочірньою це
      //    бронь, яку картка й аркуші дня показують скасованою, поки гість
      //    заселяється.
      //
      //    Кімната, що зникла, лишається — скасованою дочірньою зі СВОЇМ
      //    ключем і СВОЇМ типом: вона була, і в звіті за минулий місяць має
      //    лишитись. Тобто рядки міняються місцями, а не зникають.
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      const shrunk = await applyRevision(sql, CONN, groupRev({ remoteRevisionId: 'grp-3', status: 'modified',
        checkIn: '2026-10-12', checkOut: '2026-10-15', adults: 1, children: 0, totalPrice: 230 }, [
        { key: 'u:50', unitTypeId: TYPE2, checkIn: '2026-10-12', checkOut: '2026-10-15', adults: 1, children: 0, amount: 210 },
      ]));
      assert.strictEqual(shrunk.result, 'applied');
      {
        const { parent, kids, subs } = await group();
        assert.strictEqual(String(parent.status), 'confirmed',
          'майстер скасувався разом зі своєю кімнатою — жива кімната лишилась під скасованою бронню');
        assert.strictEqual(String(parent.external_uid), `${CODE}#u:50`,
          'майстер мав перейняти кімнату №2 (rekey) — інакше він тримає ключ кімнати, якої вже немає');
        assert.strictEqual(String(parent.unit_type_id), TYPE2, 'майстер мав узяти тип кімнати, яку перейняв');
        assert.strictEqual(String(parent.check_in).slice(0, 10), '2026-10-12', 'дати майстра — дати перейнятої кімнати');
        assert.strictEqual(String(parent.check_out).slice(0, 10), '2026-10-15');
        assert.strictEqual(Number(parent.total_price), 210, 'сума майстра — сума перейнятої кімнати');

        assert.strictEqual(kids.length, 1, 'дочірня зникла з бази — скасування не стирає бронь');
        assert.strictEqual(String(kids[0].external_uid), `${CODE}#u:49`,
          'скасованою має лишитись саме прибрана кімната — ключ на те й потрібен');
        assert.strictEqual(String(kids[0].status), 'cancelled', 'прибрана кімната мала скасуватись');
        assert.strictEqual(String(kids[0].unit_type_id), TYPE,
          'скасованій кімнаті переписали тип — її ночі звільнились би не з того типу');

        assert.strictEqual(subs.length, 1,
          'рядок групи лишився на кімнаті, якої вже немає — фоліо виставить за неї гроші');
        assert.strictEqual(subs[0].child_reservation_id ?? null, null,
          'єдина жива кімната тепер у майстра, отже й рядок групи в неї без дочірньої');
        assert.strictEqual(String(subs[0].label), 'TW', 'рядок групи мав піти за перейнятою кімнатою');
        assert.strictEqual(Number(subs[0].subtotal), 210);

        assert.strictEqual(await busyOn('2026-10-12'), 1,
          'після прибраної кімнати зайнятим лишається рівно один номер');
        assert.strictEqual(await busyOn('2026-10-11'), 0, 'ночі прибраної кімнати мали звільнитись повністю');
        assert.deepStrictEqual(await noted(), [TYPE, TYPE2].sort(),
          'звільнені ночі прибраної кімнати мали поїхати в канал — інакше номер лишиться непроданим');
      }
      console.log('  ok  зникла кімната №1 — майстер переймає кімнату №2, прибрана лишається скасованою');

      // 4. Скасувати — усю групу.
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      const gone = await applyRevision(sql, CONN, groupRev({ remoteRevisionId: 'grp-4', status: 'cancelled' }));
      assert.strictEqual(gone.result, 'applied');
      {
        const { parent, kids } = await group();
        assert.strictEqual(String(parent.status), 'cancelled', 'скасування не дійшло до майстра');
        assert.deepStrictEqual(kids.map((k) => String(k.status)), ['cancelled'],
          'дочірні лишились активними після скасування бронювання — номери стояли б зайнятими');
        assert.strictEqual(await busyOn('2026-10-12'), 0, 'скасована група не займає жодного номера');
        assert.deepStrictEqual(await noted(), [TYPE2],
          'звільнені ночі живої кімнати мали поїхати в канал — і саме її типу');
      }
      console.log('  ok  скасування ревізії скасовує всю групу');

      // Історія — на майстрі, по запису на ревізію: рецепція читає групу в
      // одному місці, а не збирає з чотирьох карток. Сума бронювання (555 при
      // кімнатах 510) живе САМЕ ТУТ і в журналі ревізій — не в рядку броні.
      {
        const rows = await sql.rows<any>(
          `SELECT action, details FROM booking_activity_log
            WHERE organization_id = ? AND reservation_id = ? ORDER BY created_at ASC, id ASC`,
          [ORG, groupId]) as any[];
        // Одинадцять ревізій: сім початкових плюс чотири зі сцени 2e (гість,
        // повернення кімнати, позиції фоліо, повернення для наступного кроку).
        // Число тут не окраса: воно й стверджує, що КОЖНА ревізія лишає рядок
        // історії, тож нова сцена мусить його зрушити, а не проскочити повз.
        assert.deepStrictEqual(rows.map((r) => r.action),
          ['channel_created', ...Array(9).fill('channel_modified'), 'channel_cancelled'],
          `одинадцять ревізій групи — стільки ж записів історії на майстрі, а є: ${JSON.stringify(rows.map((r) => r.action))}`);
        assert.ok(String(rows[0].details).includes('555'),
          'сума бронювання цілком (555) не названа ніде: у рядку її нема за задумом, отже вона мусить бути в історії');
        assert.ok(/2\s*кімнат/i.test(String(rows[0].details)),
          'історія не каже, що бронювання групове — рецепція не знатиме, чому сума не дорівнює броні');
        console.log('  ok  історія групи пишеться на майстрі, сума бронювання — у ній, а не в рядку');
      }

      // 5. Бронювання, яке ПРИЙШЛО одною кімнатою, а стало двома.
      //
      //    Одинична бронь уже має свій тип і могла стояти в номері. У рідній
      //    формі вона стає кімнатою №1 групи — тобто лишається собою, і номер
      //    з неї не знімається. Зайнято має стати ДВА номери, а не три (конверт
      //    з типом) і не один (друга кімната загубилась).
      {
        const GROW = 'BDC-GROW';
        await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
        const one = await applyRevision(sql, CONN, rev({
          remoteRevisionId: 'grow-1', remoteBookingId: 'bkg-grow', otaReservationCode: GROW,
          status: 'new', checkIn: '2026-12-01', checkOut: '2026-12-03', unitTypeId: TYPE,
        }));
        assert.strictEqual(one.result, 'applied');
        const parentId = String(one.result === 'applied' ? one.reservationId : '');
        // Рецепція призначила номер — і саме це робить сцену несиметричною.
        await sql.run('UPDATE reservations SET unit_id = ? WHERE id = ?', [UNIT, parentId]);
        {
          const solo = await sql.row<any>('SELECT unit_type_id, parent_id FROM reservations WHERE id = ?', [parentId]) as any;
          assert.strictEqual(String(solo.unit_type_id), TYPE, 'одинична бронь мала лягти зі своїм типом');
          assert.strictEqual(solo.parent_id ?? null, null, 'одинична бронь не має бути дочірньою');
        }

        const grown = await applyRevision(sql, CONN, rev({
          remoteRevisionId: 'grow-2', remoteBookingId: 'bkg-grow', otaReservationCode: GROW,
          status: 'modified', checkIn: '2026-12-01', checkOut: '2026-12-04',
          adults: 3, children: 0, totalPrice: 700,
          rooms: [
            { key: 'i:0', unitTypeId: TYPE, checkIn: '2026-12-01', checkOut: '2026-12-03', adults: 2, children: 0, amount: 400 },
            { key: 'i:1', unitTypeId: TYPE2, checkIn: '2026-12-01', checkOut: '2026-12-04', adults: 1, children: 0, amount: 300 },
          ],
        }));
        assert.strictEqual(grown.result, 'applied');
        const parent = await sql.row<any>('SELECT * FROM reservations WHERE id = ?', [parentId]) as any;
        const kids = await sql.rows<any>('SELECT * FROM reservations WHERE parent_id = ? ORDER BY external_uid', [parentId]) as any[];
        const subs = await sql.rows<any>(
          'SELECT * FROM reservation_sub_bookings WHERE reservation_id = ? ORDER BY sort_order, created_at', [parentId]) as any[];
        assert.strictEqual(kids.length, 1, `друга кімната мала стати дочірньою, а дочірніх ${kids.length}`);
        assert.strictEqual(String(parent.unit_type_id), TYPE,
          'бронь, що стала групою, втратила свій тип — це знову конверт');
        assert.strictEqual(String(parent.unit_id), UNIT,
          'номер зняли з броні, яка лишилась кімнатою №1 — рецепція розселяла її даремно');
        assert.strictEqual(Number(parent.total_price), 400, 'сума майстра — сума його кімнати, а не бронювання (700)');
        assert.strictEqual(String(kids[0].unit_type_id), TYPE2, 'дочірня мала лягти на свій тип');
        assert.strictEqual(subs.length, 2, 'кімнати без рядків групи — картка покаже одну бронь замість двох');

        assert.strictEqual(await busyOn('2026-12-01'), 2,
          'бронювання з двох кімнат має займати рівно два номери: три — конверт із типом, один — загублена кімната');
        assert.strictEqual(await busyOn('2026-12-03'), 1,
          'у ніч, коли лишається лише друга кімната, зайнято один номер');
        console.log('  ok  бронь із однієї кімнати, що стала двома, лишається кімнатою №1 і займає два номери');

        await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
        await sql.run("DELETE FROM booking_activity_log WHERE organization_id = ? AND reservation_id IN (SELECT id FROM reservations WHERE organization_id = ? AND external_uid LIKE ?)",
          [ORG, ORG, `${GROW}%`]);
        await sql.run("DELETE FROM cm_inbound_bookings WHERE organization_id = ? AND remote_booking_id = 'bkg-grow'", [ORG]);
        await sql.run('DELETE FROM reservation_sub_bookings WHERE reservation_id = ?', [parentId]);
        await sql.run('DELETE FROM reservations WHERE organization_id = ? AND parent_id IS NOT NULL AND external_uid LIKE ?', [ORG, `${GROW}%`]);
        await sql.run('DELETE FROM reservations WHERE id = ?', [parentId]);
      }

      // Прибрати за собою: наступні сцени рахують броні й журнал ORG.
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [ORG]);
      await sql.run("DELETE FROM booking_activity_log WHERE organization_id = ? AND reservation_id IN (SELECT id FROM reservations WHERE organization_id = ? AND external_uid LIKE ?)",
        [ORG, ORG, `${CODE}%`]);
      await sql.run("DELETE FROM cm_inbound_bookings WHERE organization_id = ? AND remote_booking_id = 'bkg-grp'", [ORG]);
      await sql.run('DELETE FROM reservation_sub_bookings WHERE reservation_id = ?', [groupId]);
      await sql.run('DELETE FROM reservations WHERE organization_id = ? AND parent_id IS NOT NULL AND external_uid LIKE ?', [ORG, `${CODE}%`]);
      await sql.run('DELETE FROM reservations WHERE id = ?', [groupId]);
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
