/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import type { RegisteredGuest } from '../domain/types';

export async function getReservationForRegistration(token: string) {
  const sql = getSql();
  return await sql.row<any>(`
    SELECT r.id, r.guest_id as booking_guest_id, r.check_in, r.check_out, r.nights,
           r.adults, r.total_price, r.currency, r.source, r.status, r.payment_status,
           g.first_name as booking_first_name, g.last_name as booking_last_name,
           g.email as booking_email, g.phone as booking_phone,
           u.name as unit_name, ut.name as unit_type_name,
           p.organization_id, p.name as property_name
    FROM reservations r
    JOIN properties p ON r.property_id = p.id
    JOIN guests g ON r.guest_id = g.id
    JOIN units u ON r.unit_id = u.id
    JOIN unit_types ut ON u.unit_type_id = ut.id
    WHERE r.guest_page_token = ?
  `, [token]) as any;
}

export async function saveRegistrations(reservationId: string, organizationId: string, guests: RegisteredGuest[], clientIp?: string) {
  const sql = getSql();

  // Clear both tables for this reservation (idempotent re-submit)
  await sql.run('DELETE FROM reservation_guests WHERE reservation_id = ?', [reservationId]);
  await sql.run('DELETE FROM guest_registrations WHERE reservation_id = ?', [reservationId]);

  // guest_registrations sync — so the dashboard sees the data, plus GDPR
  // consent tracking. reg_status = 'completed' because this is the final
  // submit (POST), not a draft (PATCH).
  const SQL = {
    insertRg: `
      INSERT INTO reservation_guests (reservation_id, first_name, last_name, date_of_birth, address, nationality, document_type, document_number, guest_id, fee_amount, fee_exempt, fee_exempt_reason, purpose_of_stay, visa_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    findGuest: `SELECT id FROM guests WHERE organization_id = ? AND LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) LIMIT 1`,
    insertGuest: `INSERT INTO guests (organization_id, first_name, last_name, date_of_birth, country, address, document_type, document_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    updateGuest: `UPDATE guests SET date_of_birth = COALESCE(?, date_of_birth), country = COALESCE(?, country), address = COALESCE(?, address), document_type = COALESCE(?, document_type), document_number = COALESCE(?, document_number), updated_at = datetime('now') WHERE id = ?`,
    insertGr: `
      INSERT INTO guest_registrations (id, reservation_id, guest_id, is_primary, reg_status, registered_at, consent_given, consent_at, consent_ip, purpose_of_stay, visa_number)
      VALUES (?, ?, ?, ?, 'completed', datetime('now'), 1, datetime('now'), ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
    updateGrCompleted: `
      UPDATE guest_registrations
      SET guest_id = ?, reg_status = 'completed', consent_given = 1, consent_at = datetime('now'), consent_ip = ?, purpose_of_stay = ?, visa_number = ?, registered_at = datetime('now')
      WHERE reservation_id = ? AND is_primary = ?`,
    findExistingGr: `SELECT id FROM guest_registrations WHERE reservation_id = ? AND is_primary = ?`,
  };

  await sql.tx(async (t) => {
    // Get reservation nights for fee calculation
    const reservation = await t.row<any>(`
      SELECT r.adults, r.nights, p.city_tax_per_night
      FROM reservations r JOIN properties p ON r.property_id = p.id
      WHERE r.id = ?
    `, [reservationId]);
    const nights = reservation?.nights || 0;
    const cityTaxPerNight = reservation?.city_tax_per_night ?? 0;
    const needed = reservation?.adults || 1;

    let isPrimary = 1;
    for (const guest of guests) {
      if (!guest.firstName || !guest.lastName) throw new Error('firstName and lastName are required');

      let guestId: string | null = null;
      const existing = await t.row<any>(SQL.findGuest, [organizationId, guest.firstName, guest.lastName]);

      if (existing) {
        guestId = existing.id;
        await t.run(SQL.updateGuest, [guest.dateOfBirth ?? null, guest.nationality ?? null, guest.address ?? null, guest.documentType ?? null, guest.documentNumber ?? null, guestId]);
      } else {
        const result = await t.run(SQL.insertGuest, [organizationId, guest.firstName, guest.lastName, guest.dateOfBirth ?? null, guest.nationality ?? null, guest.address ?? null, guest.documentType ?? null, guest.documentNumber ?? null]);
        const newGuest = await t.row<any>('SELECT id FROM guests WHERE rowid = ?', [result.lastId]);
        guestId = newGuest?.id ?? null;
      }

      // Calculate age for fee exemption
      let feeExempt = 0;
      let feeAmount = nights * cityTaxPerNight;
      let feeReason: string | null = null;
      if (guest.dateOfBirth) {
        const dob = new Date(guest.dateOfBirth);
        const ageDifMs = Date.now() - dob.getTime();
        const ageDate = new Date(ageDifMs); 
        const age = Math.abs(ageDate.getUTCFullYear() - 1970);
        if (age < 18) {
          feeExempt = 1;
          feeAmount = 0;
          feeReason = 'Dítě do 18 let';
        }
      }

      // Write to reservation_guests (guest portal view)
      await t.run(SQL.insertRg, [reservationId, guest.firstName, guest.lastName, guest.dateOfBirth ?? null, guest.address ?? null, guest.nationality ?? null, guest.documentType ?? null, guest.documentNumber ?? null, guestId, feeAmount, feeExempt, feeReason, guest.purposeOfStay || 'Tourism', guest.visaNumber ?? null]);

      // Write to guest_registrations (dashboard view) — syncs data to PMS
      if (guestId) {
        const existingGr = await t.row<any>(SQL.findExistingGr, [reservationId, isPrimary]);
        if (existingGr) {
          // Draft exists — upgrade to completed
          await t.run(SQL.updateGrCompleted, [guestId, clientIp ?? null, guest.purposeOfStay ?? null, guest.visaNumber ?? null, reservationId, isPrimary]);
        } else {
          const grId = crypto.randomUUID();
          await t.run(SQL.insertGr, [grId, reservationId, guestId, isPrimary, clientIp ?? null, guest.purposeOfStay ?? null, guest.visaNumber ?? null]);
        }
        isPrimary = 0; // only first guest is primary
      }
    }

    // Update reservation registration_status
    const status = guests.length >= needed ? 'registered' : 'not_registered';
    await t.run("UPDATE reservations SET registration_status = ? WHERE id = ?", [status, reservationId]);
  });

  return await sql.rows<any>('SELECT * FROM reservation_guests WHERE reservation_id = ? ORDER BY created_at', [reservationId]);
}
// ── GDPR Data Retention ───────────────────────────────────────────────────

export async function anonymizeOldRegistrations(monthsToKeep = 6): Promise<number> {
  try {
    const sql = getSql();
    
    // Find all registrations where the associated reservation check_out is older than X months
    // and the data is not already anonymized
    const info = await sql.run(`
      UPDATE guest_registrations
      SET 
        first_name = 'Anonymized',
        last_name = 'Anonymized',
        date_of_birth = NULL,
        document_number = NULL,
        document_type = NULL,
        nationality = NULL,
        address = NULL,
        email = NULL,
        phone = NULL
      WHERE id IN (
        SELECT gr.id
        FROM guest_registrations gr
        JOIN reservations r ON gr.reservation_id = r.id
        WHERE r.check_out < date('now', '-' || ? || ' months')
          AND gr.first_name != 'Anonymized'
      )
    `, [monthsToKeep]);
    return info.changes;
  } catch (error) {
    console.error('Failed to anonymize old registrations:', error);
    return 0;
  }
}
