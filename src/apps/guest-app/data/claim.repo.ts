/**
 * Попередня бронь із воріт: гість забронював у готелю і назвався нам.
 *
 * ── Що тримає «двічі натиснув — одна бронь» ─────────────────────────────
 *
 * База, а не старанність цього файла. На `reservations.external_ref` стоїть
 * `UNIQUE (organization_id, external_ref) WHERE external_ref IS NOT NULL`
 * (INC-301), тож друге подання впирається в обмеження навіть тоді, коли два
 * запити пішли одночасно з двох телефонів.
 *
 * Читання перед записом усе одно є — але не замість обмеження, а щоб
 * відповісти по-людськи замість 500 на порушенні UNIQUE.
 *
 * ── Ціни немає, і це не забудькуватість ─────────────────────────────────
 *
 * Цю бронь рахувала ЧУЖА система: гість щойно бачив у ній суму, і вигадати
 * тут друге число означало б показати йому дві різні ціни за одне
 * перебування. `total_price = 0` до приходу дельти, і екран про гроші мовчить
 * (інваріант 17).
 *
 * ── Номера теж немає ────────────────────────────────────────────────────
 *
 * `unit_id` лишається порожнім: яку кімнату продав готель, знає готель.
 * Призначити свою означало б зайняти ту, яку він щойно продав комусь іншому.
 * Бронь лягає у смугу «Без номера», і рецепція бачить її вранці.
 */
import crypto from 'node:crypto';
import { getSql } from '@core/db/async';
import { refuse } from '@core/http/refusal';
import { ALL_PROPERTIES, propertyScopeFilter } from '@core/property-scope';
import { claimRef, claimNights, type ClaimInput } from '../domain/claim';

/** Рід походження — той самий, що в кіоску: попередня бронь чужої системи. */
export const CLAIM_SOURCE = 'kiosk_walkin';

export interface ClaimedStay {
  reservationId: string;
  token: string;
  /** `false` — таку заявку вже приймали; це повтор, а не друга бронь. */
  created: boolean;
}

/**
 * Прийняти заявку. Кличеться ВСЕРЕДИНІ `runWithOrganization` — орендаря
 * називає ключ у адресі, а не тіло запиту (інваріанти 1 і 8).
 */
export async function claimStay(
  organizationId: string, propertyId: string, claim: ClaimInput,
): Promise<ClaimedStay> {
  const sql = getSql();
  const ref = claimRef(claim.confirmation);

  // Вісь обʼєкта тут ALL_PROPERTIES, і це рішення, а не пропуск: читається
  // ВЕСЬ рахунок навмисно, бо саме звідси видно «той самий номер підтвердження
  // в сусідньому корпусі». Звузити до свого будинку означало б не побачити
  // чужої броні й завести другу з тим самим ключем — а `UNIQUE` на
  // `(organization_id, external_ref)` відповів би на це 500 замість речення.
  const everyHouse = propertyScopeFilter(ALL_PROPERTIES, '');
  const existing = await sql.row<{ id: string; property_id: string; guest_page_token: string | null }>(
    `SELECT id, property_id, guest_page_token FROM reservations
      WHERE organization_id = ? AND external_ref = ? AND ${everyHouse.sql}`,
    [organizationId, ref, ...everyHouse.params]);
  if (existing) {
    // Той самий номер підтвердження в СУСІДНЬОМУ корпусі — чужа бронь, і
    // відповідь про неї 404, а не 403: інакше вона підтверджує, що така
    // бронь десь є (інваріант 5).
    if (existing.property_id !== propertyId) refuse('Не знайдено', 404);
    if (!existing.guest_page_token) refuse('Зверніться, будь ласка, на рецепцію', 409);
    return { reservationId: existing.id, token: existing.guest_page_token, created: false };
  }

  const guestId = `gg_${crypto.randomBytes(8).toString('hex')}`;
  const reservationId = `gr_${crypto.randomBytes(8).toString('hex')}`;
  // 128 біт із криптографічного джерела — те саме, що в броні з воріт, і з
  // тієї ж причини: це посилання-перепустка до чужого перебування (INC-207).
  const token = crypto.randomBytes(16).toString('hex');

  // `organization_id` названо ЯВНО в обох `INSERT` (інваріант 12): на SQLite
  // DEFAULT від контексту не існує, і рядок дістав би NULL-орендаря
  // беззвучно — бронь, якої не бачить жоден готель.
  await sql.run(
    'INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    [guestId, organizationId, claim.firstName || '—', claim.lastName]);
  await sql.run(`
    INSERT INTO reservations (id, organization_id, property_id, guest_id,
                              check_in, check_out, nights, adults,
                              status, payment_status, source, external_ref,
                              total_price, currency, guest_page_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'tentative', 'unpaid', ?, ?, 0,
            (SELECT default_currency FROM organizations WHERE id = ?), ?)
  `, [reservationId, organizationId, propertyId, guestId,
    claim.checkIn, claim.checkOut, claimNights(claim.checkIn, claim.checkOut), claim.adults,
    CLAIM_SOURCE, ref, organizationId, token]);

  // Черги каналів тут немає навмисно, і це не пропущений виклик: кімнату ця
  // бронь не займає (`unit_id` порожній), а наявність цього обʼєкта веде
  // чужа система — вона ж і розсилає її в канали. Наша звістка сказала б
  // каналу те, чого ми не знаємо.
  return { reservationId, token, created: true };
}
