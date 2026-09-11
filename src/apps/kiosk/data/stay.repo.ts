/**
 * Що термінал читає про перебування — і рівно стільки, скільки показує.
 *
 * Кожен запит тут названий і орендарем, і БУДИНКОМ (`property_id = ?`): вісь
 * рахунку двох корпусів одного готелю не розрізняє, а термінал стоїть у холі
 * одного з них (INC-029). На SQLite політик немає взагалі, тож умова мусить
 * бути в запиті, а не покладатись на контекст (AGENTS §7).
 */
import { getSql } from '@core/db/async';
import { dayAfter, inWindow, phoneDigits, PHONE_MIN_DIGITS, readSearchDate, type SearchInput } from '../domain/search';

export interface StayRow {
  id: string;
  property_id: string;
  unit_id: string | null;
  unit_name: string | null;
  unit_type_name: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  status: string;
  payment_status: string;
  registration_status: string | null;
  currency: string | null;
  guest_page_token: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  guest_country: string | null;
}

const SELECT = `
  SELECT r.id, r.property_id, r.unit_id, u.name AS unit_name, ut.name AS unit_type_name,
         r.check_in, r.check_out, r.nights, r.adults, r.children,
         r.status, r.payment_status, r.registration_status, r.currency, r.guest_page_token,
         g.first_name, g.last_name, g.email, g.country AS guest_country
    FROM reservations r
    JOIN guests g ON g.id = r.guest_id
    LEFT JOIN units u ON u.id = r.unit_id AND u.property_id = r.property_id
    LEFT JOIN unit_types ut ON ut.id = r.unit_type_id
`;

/** Статуси, які термінал взагалі бачить: скасоване й неявка — не перебування. */
const LIVE = "r.status IN ('tentative', 'confirmed', 'checked_in')";

/**
 * Кандидати за названими чинниками. Вікно ±1 день накладається ПІСЛЯ, у
 * памʼяті, і це навмисно: правило вікна — домен (`inWindow`), і другий його
 * примірник у SQL розійшовся б із першим при першій же правці. Кандидатів
 * тут одиниці — це один готель на одну добу, а не звіт.
 */
export async function findStays(input: {
  organizationId: string;
  propertyId: string;
  search: SearchInput;
  window: { from: string; to: string };
}): Promise<StayRow[]> {
  const sql = getSql();
  const s = input.search;
  const clean = (v: unknown) => String(v ?? '').trim();

  const where: string[] = [`r.organization_id = ?`, `r.property_id = ?`, LIVE];
  const params: unknown[] = [input.organizationId, input.propertyId];

  if (clean(s.token)) { where.push('r.guest_page_token = ?'); params.push(clean(s.token)); }
  if (clean(s.lastName)) { where.push('LOWER(g.last_name) = LOWER(?)'); params.push(clean(s.lastName)); }
  // Дату читає ДОМЕН (`readSearchDate`), і сюди не-день не доходить: хендлер
  // відмовляє 400 раніше, бо такий рядок не рахується чинником. Тут лишається
  // те, що вже є днем, — і тому `dayAfter` не може кинути.
  //
  // Доба ПІВІНТЕРВАЛОМ, не `SUBSTR(check_in, 1, 10) = ?`. Перша редакція різала
  // рядок: на SQLite `check_in` це TEXT, і працювало. На Postgres це DATE, і
  // `substr(date, integer, integer)` не існує — маршрут пошуку відповідав 500
  // на КОЖЕН запит гостя. Півінтервал розуміють обидва рушії, і `'2026-09-11
  // 14:00'` теж потрапляє в `['2026-09-11', '2026-09-12')`, чого рівність із
  // обрізаним рядком досягала лише випадково.
  const checkInDay = readSearchDate(s.checkIn);
  if (checkInDay) {
    where.push('r.check_in >= ? AND r.check_in < ?');
    params.push(checkInDay, dayAfter(checkInDay));
  }
  if (clean(s.email)) { where.push('LOWER(g.email) = LOWER(?)'); params.push(clean(s.email)); }
  // Телефон звіряється за ХВОСТОМ, і в базі теж без розділювачів: гість
  // друкує «+49 170 …», а в рядку лежить «0170-…» — той самий номер, інша
  // форма, і рівність не збіглася б жодного разу.
  //
  // Чи це взагалі чинник, вирішує ДОМЕН (`namedFactors` → `PHONE_MIN_DIGITS`),
  // і сюди короткий номер не доходить: хендлер відмовляє 400 раніше. Тому тут
  // немає гілки «занадто короткий» — вона була, і саме вона ховала дефект:
  // запит чесно не знаходив нічого, а гість читав «не знайдено» замість
  // «введіть ще одне поле».
  const digits = phoneDigits(s.phone);
  if (digits.length >= PHONE_MIN_DIGITS) {
    where.push(
      "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(g.phone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE ?");
    params.push(`%${digits.slice(-PHONE_MIN_DIGITS)}`);
  }
  if (clean(s.confirmation)) {
    // «Номер броні» — одне слово для гостя і ТРИ різні поля в базі, бо
    // залежить, звідки бронь приїхала:
    //
    //   наш `id`                    — бронь завели ми;
    //   `external_uid`              — код каналу (Booking.com і решта);
    //   `external_ref` з префіксом  — номер онлайн-модуля готелю.
    //
    // Гість цього не знає й не має знати: він друкує те число, що бачить у
    // листі.
    //
    // ── Груповий заїзд, і чому без нього код не знаходився ────────────────
    //
    // Одне бронювання Booking.com на три кімнати стає в нас трьома бронями, і
    // писач каналу кладе в `external_uid` не код, а `<код>#<ключ кімнати>` —
    // інакше рядки не були б унікальні (`inbound-bookings.repo`). Тобто гість
    // друкував рівно те, що в листі, а рівність не збігалася ЖОДНОГО разу:
    // в базі `4451234567#a`, на екрані «броні не знайдено».
    //
    // Тому друга умова — префікс до `#`. Підстановні знаки в коді
    // ЕКРАНУЮТЬСЯ: без цього `%` у полі перетворив би пошук за номером на
    // пошук за зразком, тобто на підбір чужих броней.
    const c = clean(s.confirmation);
    const likePrefix = `${c.replace(/[\\%_]/g, (ch) => `\\${ch}`)}#%`;
    where.push(
      "(r.id = ? OR r.external_ref = ? OR r.external_uid = ? OR r.external_uid LIKE ? ESCAPE '\\')");
    params.push(c, `winhotel-ob:${c}`, c, likePrefix);
  }

  const rows = (await sql.rows<StayRow>(`${SELECT} WHERE ${where.join(' AND ')} LIMIT 20`, params)) as StayRow[];
  return rows.filter((r) => inWindow({ checkIn: r.check_in, checkOut: r.check_out }, input.window));
}

/** Одне перебування свого будинку — після того, як його вже знайшли. */
export async function stayById(input: {
  organizationId: string; propertyId: string; reservationId: string;
}): Promise<StayRow | undefined> {
  return await getSql().row<StayRow>(
    `${SELECT} WHERE r.id = ? AND r.organization_id = ? AND r.property_id = ?`,
    [input.reservationId, input.organizationId, input.propertyId]);
}

/** Гості перебування — те, що показує картка реєстрації. */
export async function stayGuests(input: {
  organizationId: string; propertyId: string; reservationId: string;
}): Promise<{ first_name: string; last_name: string; nationality: string | null; document_type: string | null; date_of_birth: string | null }[]> {
  return (await getSql().rows(`
    SELECT rg.first_name, rg.last_name, rg.nationality, rg.document_type, rg.date_of_birth
      FROM reservation_guests rg
      JOIN reservations r ON r.id = rg.reservation_id
     WHERE rg.reservation_id = ? AND r.organization_id = ? AND r.property_id = ?
     ORDER BY rg.created_at
  `, [input.reservationId, input.organizationId, input.propertyId])) as any[];
}

/** Wi-Fi, телефон рецепції і WhatsApp — з конфігурації ОБʼЄКТА. */
export async function propertyGuestConfig(organizationId: string, propertyId: string): Promise<{
  wifi_network: string | null; wifi_password: string | null;
  emergency_phone: string | null; whatsapp_phone: string | null;
  parking_info: string | null; rules: string | null; useful_info: string | null;
  restaurant_name: string | null; restaurant_hours: string | null; maps_url: string | null;
} | undefined> {
  return await getSql().row(`
    SELECT c.wifi_network, c.wifi_password, c.emergency_phone, c.whatsapp_phone,
           c.parking_info, c.rules, c.useful_info,
           c.restaurant_name, c.restaurant_hours, c.maps_url
      FROM property_guest_config c
      JOIN properties p ON p.id = c.property_id
     WHERE c.property_id = ? AND p.organization_id = ?
  `, [propertyId, organizationId]);
}
