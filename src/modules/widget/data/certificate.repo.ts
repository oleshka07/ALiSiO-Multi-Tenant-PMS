/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Sql } from '../../../core/db/async.ts';

// `gift_cards.currency` — NOT NULL, тож `|| 'CZK'` тут не спрацьовував ніколи.
// Гірше: у порівнянні вище він означав «сертифікат без валюти вважаємо
// кронським», тобто міг би прийняти чужу валюту до оплати.

/**
 * Gift certificate redemption for the widget.
 *
 * Until now the widget ACCEPTED a certificate code and applied a discount of
 * zero: availability echoed the code back as if it counted, reserve booked at
 * full price. The guest thought they had paid with their gift.
 *
 * The lifecycle already exists on gift_cards — draft → active/paid →
 * activated (attached to a reservation) / cancelled / expired — this module
 * only adds the online path through the same states the front desk uses.
 *
 * Deliberately narrow: only fixed-value certificates (value_type fixed_czk /
 * fixed_eur) in the reservation's own currency are redeemed online, one per
 * booking, single-use, no partial balance — the schema stores a face value
 * and one reservation_id, so partial redemption has nowhere to live. Percent
 * and nights certificates get an honest "at the front desk" answer.
 */

export interface CertificateQuote {
  id: string;
  code: string;
  /** What this certificate is worth against the given total. */
  amount: number;
  currency: string;
}

export type CertificateAnswer =
  | { valid: true; quote: CertificateQuote }
  | { valid: false; message: string };

const AT_DESK = 'Цей сертифікат погашається на рецепції — бронюйте, і його зарахують при заселенні.';

export async function quoteCertificate(
  sql: Sql,
  organizationId: string,
  code: string,
  totalPrice: number,
  currency: string,
): Promise<CertificateAnswer> {
  const row = await sql.row<any>(`
    SELECT id, code, value_type, face_value, currency, status, expires_at
    FROM gift_cards
    WHERE organization_id = ? AND UPPER(code) = UPPER(TRIM(?))
  `, [organizationId, code]) as any;

  if (!row) return { valid: false, message: 'Сертифікат не знайдено.' };
  if (row.status === 'activated') return { valid: false, message: 'Сертифікат уже використано.' };
  if (row.status === 'cancelled') return { valid: false, message: 'Сертифікат скасовано.' };
  if (row.status === 'expired') return { valid: false, message: 'Термін дії сертифіката минув.' };
  if (row.status !== 'active' && row.status !== 'paid') {
    return { valid: false, message: 'Сертифікат ще не активний.' };
  }
  if (row.expires_at && String(row.expires_at).slice(0, 10) < new Date().toISOString().slice(0, 10)) {
    return { valid: false, message: 'Термін дії сертифіката минув.' };
  }

  const fixed = row.value_type === 'fixed_czk' || row.value_type === 'fixed_eur';
  if (!fixed) return { valid: false, message: AT_DESK };
  if (row.currency !== currency) return { valid: false, message: AT_DESK };
  if (!(row.face_value > 0)) return { valid: false, message: 'Сертифікат має нульовий номінал.' };

  return {
    valid: true,
    quote: {
      id: row.id,
      code: row.code,
      amount: Math.min(row.face_value, Math.max(0, totalPrice)),
      currency: row.currency,
    },
  };
}

/**
 * Attach the certificate to the reservation — the same transition the front
 * desk's activate endpoint makes. The status guard in the WHERE is what makes
 * two simultaneous redemptions impossible: the second UPDATE changes nothing
 * and the caller takes the discount back.
 */
export async function claimCertificate(sql: Sql, certificateId: string, reservationId: string): Promise<boolean> {
  const r = await sql.run(`
    UPDATE gift_cards
    SET status = 'activated', reservation_id = ?,
        activated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('active', 'paid')
  `, [reservationId, certificateId]);
  return r.changes === 1;
}
