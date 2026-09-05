/**
 * The guest portal's tenant, discovered from the link the guest followed.
 *
 * A guest is not a tenant and has no session: the only thing the request
 * carries is `guest_page_token` in the URL. Everything the portal touches —
 * the reservation, its services, its registrations, its payments — is scoped,
 * so without an organization the row-level policies return nothing and the
 * whole portal answers 404. That is what happened the day production moved to
 * Postgres.
 *
 * It cannot be solved the way the widget was. The widget arrives with a public
 * site key and `booking_sites` is readable before a tenant is known, because a
 * list of booking sites is public information. A list of reservations is not,
 * so `reservations` stays closed and the token itself becomes the credential:
 * it goes onto the connection (`app.public_token`), and the policy matches the
 * one row whose `guest_page_token` equals it. See PUBLIC_TOKEN_READ in
 * scripts/pg-schema.mjs for what that opens and what it does not.
 *
 * The window is one statement wide. Having read that row the caller knows the
 * organization, and everything after runs under the ordinary tenant context —
 * so a bug inside the portal can reach that hotel's data and no further.
 */
import { getSql } from '@core/db/async';
import { runWithPublicToken, runWithOrganization } from '@core/auth/tenant-context';
import { hasFeature } from '@core/features';

export interface GuestReservation {
  id: string;
  organization_id: string;
  property_id: string | null;
}

/**
 * Resolve the token, then run `fn` as the hotel that owns it.
 *
 * Returns null when the token names nothing — an expired link, a typo, or a
 * guess. The caller turns that into 404, and it is the same 404 for all three:
 * a different answer would say whether the token exists.
 */
export async function withGuestReservation<T>(
  token: string | null | undefined,
  fn: (reservation: GuestReservation) => Promise<T>,
): Promise<T | null> {
  if (!token) return null;

  const reservation = await runWithPublicToken(token, () =>
    getSql().row<GuestReservation>(
      'SELECT id, organization_id, property_id FROM reservations WHERE guest_page_token = ?',
      [token],
    ));

  // No row, or a row from before organization_id was backfilled: either way
  // there is no hotel to act as, and guessing one is how a guest ends up
  // looking at somebody else's booking.
  if (!reservation?.organization_id) return null;

  // Гостьова сторінка — платний модуль (`guest_page`, П15). Сесії тут немає,
  // тож `withModule` не підходить; варта та сама, поставлена після того, як
  // токен назвав готель: у готелю без модуля посилання відповідає тим самим
  // 404, що й неіснуючий токен. Це ВАРТА, не заслінка — без неї ключ у
  // налаштуваннях був би перемикачем-обманкою (П5), а гостьовий портал
  // відкривався б кожному готелю безкоштовно. `hasFeature` читає рядок у
  // контексті організації, про яку питає (INC-014).
  if (!(await hasFeature(reservation.organization_id, 'guest_page'))) return null;

  return runWithOrganization(reservation.organization_id, () => fn(reservation));
}
