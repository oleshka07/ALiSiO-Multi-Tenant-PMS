import { getSql } from '@core/db/async';
import { likePattern, SEARCH_LIMIT, type SearchHit } from '@core/search-types';

/**
 * Знайти бронь: за іменем гостя, номером кімнати, нашим ідентифікатором або
 * кодом броні на боці каналу (`external_uid`, як BDC-6654654654).
 *
 * Ідентифікатори в списку навмисно: половина запитів на рецепції починається
 * з того, що гість читає код із листа Booking, а не називає прізвище.
 *
 * ── Чому пошук НЕ звужується областю обʼєкта (INC-029) ─────────────────
 *
 * Портьє набирає прізвище, і бронь може стояти в іншому будинку компанії;
 * звузити пошук означало б «не знайдено» на річ, яка є. Тому він лишається по
 * рахунку — але тоді ЗОБОВʼЯЗАНИЙ сказати, ЯКИЙ це будинок. Та сама умова, що
 * для `searchUnits`, і `searchBookings` її не виконував: у підказці стояли код
 * каналу і номер кімнати, а два однойменні гості в двох будинках давали два
 * нерозрізненні рядки, і відкривалась не та бронь.
 *
 * Скасовані й неявки не ховаються. Саме їх шукають найчастіше — «а що там
 * було з тією бронню» — і якщо пошук їх не показує, людина йде дивитись
 * вручну по списку, тобто пошук не зекономив нічого.
 */
export async function searchBookings(term: string, organizationId: string): Promise<SearchHit[]> {
  const sql = getSql();
  const p = likePattern(term);
  const like = sql.dialect.ilike;

  const rows = await sql.rows<any>(`
    SELECT r.id, r.check_in, r.check_out, r.status, r.total_price, r.currency, r.external_uid,
           g.first_name, g.last_name,
           u.name AS unit_name,
           p.name AS property_name
    FROM reservations r
    LEFT JOIN guests g ON g.id = r.guest_id
    LEFT JOIN units  u ON u.id = r.unit_id
    LEFT JOIN properties p ON p.id = r.property_id
    WHERE r.organization_id = ?
      AND (
        ${like('g.first_name')}
        OR ${like('g.last_name')}
        OR ${like("COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')")}
        OR ${like('u.name')}
        OR ${like('r.id')}
        OR ${like('r.external_uid')}
      )
    ORDER BY r.check_in DESC
    LIMIT ${SEARCH_LIMIT}
  `, [organizationId, p, p, p, p, p, p]);

  // Будинок називається ЛИШЕ тоді, коли він щось розрізняє — тобто коли в
  // знайденому є більше ніж один. У готелю з одним будинком його назва в
  // кожному рядку була б шумом, і рахується вона з уже прочитаних рядків, без
  // другого запиту до бази.
  const manyProperties = new Set(rows.map((r: any) => r.property_name).filter(Boolean)).size > 1;

  return rows.map((r: any) => ({
    id: String(r.id),
    title: [r.first_name, r.last_name].filter(Boolean).join(' ') || String(r.id),
    subtitle: [
      manyProperties ? r.property_name : null,
      r.external_uid,
      r.unit_name,
      `${isoDay(r.check_in)} → ${isoDay(r.check_out)}`,
      r.status,
    ].filter(Boolean).join(' · '),
    href: `/app/bookings?q=${encodeURIComponent(term)}`,
  }));
}

/**
 * Дата як рядок, звідки б вона не прийшла.
 *
 * `check_in` — TEXT у SQLite і DATE у Postgres, тож те саме поле приїжджає
 * рядком або обʼєктом Date. `String(new Date())` дає «Wed Sep 09 2026
 * 02:00:00 GMT+0200», що в рядку пошуку виглядає як помилка.
 */
function isoDay(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
