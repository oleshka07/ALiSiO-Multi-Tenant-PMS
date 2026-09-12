/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import type { Sql } from '@core/db/async';
import type { RegisteredGuest } from '../domain/types';
import { retentionCutoff } from '../domain/retention';
import { runWithOrganization } from '@core/auth/tenant-context';

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
    LEFT JOIN units u ON r.unit_id = u.id
    LEFT JOIN unit_types ut ON u.unit_type_id = ut.id
    WHERE r.guest_page_token = ?
  `, [token]) as any;
}

/** Що потрібно від броні, щоб порахувати збір: ночі, дорослі, ставка обʼєкта. */
async function stayFacts(t: Sql, reservationId: string): Promise<{ adults: number; nights: number; city_tax_per_night: number } | undefined> {
  return await t.row<any>(`
      SELECT r.adults, r.nights, p.city_tax_per_night
      FROM reservations r JOIN properties p ON r.property_id = p.id
      WHERE r.id = ?
    `, [reservationId]);
}

/** Збір за особу: ночі × ставка; дитина до 18 — звільнена (як на порталі). */
function cityTaxFor(nights: number, perNight: number, dateOfBirth: string | null | undefined): { amount: number; exempt: 0 | 1; reason: string | null } {
  if (dateOfBirth) {
    const age = Math.abs(new Date(Date.now() - new Date(dateOfBirth).getTime()).getUTCFullYear() - 1970);
    if (age < 18) return { amount: 0, exempt: 1, reason: 'Dítě do 18 let' };
  }
  return { amount: nights * perNight, exempt: 0, reason: null };
}

export interface ReceptionGuestSnapshot {
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
  address?: string | null;
  nationality?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
}

/**
 * Реєстрація гостя з картки броні (рецепція) — в ОБИДВІ книги, як портал
 * (Д16). `guest_registrations` рахує `registration_status` і стереже
 * заселення; `reservation_guests` читають Meldeschein, Evidenční kniha і
 * портал. Рецепція писала лише першу — і книга гостей не бачила гостей,
 * зареєстрованих на стійці (рецензія 07.09 п.3).
 *
 * Повертає id рядка `guest_registrations`; той самий гість двічі на одній
 * броні — `null` (409 у викликача).
 */
export async function addReceptionRegistration(input: {
  reservationId: string;
  guestId: string;
  isPrimary: boolean;
  guest: ReceptionGuestSnapshot;
  /**
   * Мета приїзду й номер візи — від того, хто РЕЄСТРУЄ, а не з коду.
   *
   * Тут стояв літерал `'Tourism'`, і це була неправда про живу людину
   * на документі для влади: гостя ніхто не питав, а виправити потім було
   * нічим. Не названо — ПОРОЖНЬО: порожнє поле видно в реєстрі й його
   * доповнюють, а вигадане виглядає як відповідь гостя (гейт `purpose-of-stay.check`).
   */
  purposeOfStay?: string | null;
  visaNumber?: string | null;
}): Promise<string | null> {
  const sql = getSql();
  return await sql.tx(async (t) => {
    const dup = await t.row<any>('SELECT id FROM guest_registrations WHERE reservation_id = ? AND guest_id = ?', [input.reservationId, input.guestId]);
    if (dup) return null;
    const facts = await stayFacts(t, input.reservationId);
    const fee = cityTaxFor(facts?.nights || 0, facts?.city_tax_per_night ?? 0, input.guest.dateOfBirth);
    const regId = `gr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await t.run(`
      INSERT INTO guest_registrations (id, reservation_id, guest_id, is_primary, registered_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [regId, input.reservationId, input.guestId, input.isPrimary ? 1 : 0]);
    await t.run(`
      INSERT INTO reservation_guests (reservation_id, first_name, last_name, date_of_birth, address, nationality, document_type, document_number, guest_id, fee_amount, fee_exempt, fee_exempt_reason, purpose_of_stay, visa_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [input.reservationId, input.guest.firstName, input.guest.lastName, input.guest.dateOfBirth ?? null, input.guest.address ?? null,
      input.guest.nationality ?? null, input.guest.documentType ?? null, input.guest.documentNumber ?? null, input.guestId,
      fee.amount, fee.exempt, fee.reason,
      input.purposeOfStay?.trim() || null, input.visaNumber?.trim() || null]);
    return regId;
  });
}

/**
 * Змінити ЗАЯВНИКА на броні. `false` — такого рядка в нас немає.
 *
 * ── Що саме вирішує зірка ─────────────────────────────────────────────
 *
 * `meldeschein.repo` і `signature.repo` сортують `ORDER BY gr.is_primary DESC`
 * і беруть першого: заявник — той, хто ПІДПИСУЄ Meldeschein за все
 * перебування. Доти його обирала єдина умова в екрані — «хто перший,
 * той і заявник», — і змінити це можна було лише, знявши й завівши наново
 * всіх. Документ при цьому виглядав нормально — просто з чужим прізвищем.
 *
 * ── Чому в ОДНІЙ транзакції і двома `UPDATE` ──────────────────────
 *
 * Зірка мусить ПЕРЕЇХАТИ, а не додатись: двоє заявників на одній броні —
 * це документ, чий підписант залежить від порядку рядків у вибірці, тобто
 * від рушія бази (AGENTS §7, INC-027). Скидання й призначення розірвані
 * помилкою залишили б бронь БЕЗ заявника взагалі.
 *
 * ── Орендар — у SQL, а не лише в політиці ──────────────────────────
 *
 * `guest_registrations` не має `organization_id`: на Postgres політика виводить
 * орендаря через `guests`. На SQLite політик немає взагалі (AGENTS §7), і без
 * цього приєднання пара «чужа бронь + її ж рядок» зійшлась б між собою й
 * пройшла.
 *
 * Приєднання саме до `reservations`, а не до `guests`, хоч політика робить
 * друге — і це свідомо дорожче. Рядок, чий `guest_id` — НАШ гість, а бронь —
 * СУСІДА, за версією `guests` був би «наш», і зірка переїхала б на ЧУЖІЙ
 * броні. Ціна вибору названа: `check-property-scope` рахує це читанням
 * `reservations` без осі обʼєкта (стеля файла 7 → 8). Воно справді таке й є:
 * пошук ЗА ID в межах уже доведеного орендаря — той самий клас, що й сім
 * решта в цьому файлі; вибір слабшого приєднання заради меншого числа був
 * би правкою коду під гейт, а не правкою коду (AGENTS §3.2.1, сьомий випадок).
 */
export async function setPrimaryRegistration(input: {
  organizationId: string;
  reservationId: string;
  registrationId: string;
}): Promise<boolean> {
  const sql = getSql();
  return await sql.tx(async (t) => {
    const row = await t.row<{ id: string }>(
      `SELECT gr.id FROM guest_registrations gr
         JOIN reservations r ON r.id = gr.reservation_id
        WHERE gr.id = ? AND gr.reservation_id = ? AND r.organization_id = ?`,
      [input.registrationId, input.reservationId, input.organizationId]);
    // Не знайшли — ВІДМОВЛЯЄМО (інваріант 13), а не «отже, обмежень немає».
    if (!row) return false;
    await t.run('UPDATE guest_registrations SET is_primary = FALSE WHERE reservation_id = ?', [input.reservationId]);
    await t.run('UPDATE guest_registrations SET is_primary = TRUE WHERE id = ?', [input.registrationId]);
    return true;
  });
}

/** Зняти реєстрацію з картки — з обох книг. `false` — такого рядка на цій броні немає. */
export async function removeReceptionRegistration(input: { reservationId: string; registrationId: string }): Promise<boolean> {
  const sql = getSql();
  return await sql.tx(async (t) => {
    const row = await t.row<any>('SELECT guest_id FROM guest_registrations WHERE id = ? AND reservation_id = ?', [input.registrationId, input.reservationId]);
    if (!row) return false;
    await t.run('DELETE FROM guest_registrations WHERE id = ? AND reservation_id = ?', [input.registrationId, input.reservationId]);
    if (row.guest_id) await t.run('DELETE FROM reservation_guests WHERE reservation_id = ? AND guest_id = ?', [input.reservationId, row.guest_id]);
    return true;
  });
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
    // RETURNING rather than a follow-up lookup by rowid: guests.id is the
    // table's own TEXT default, and Postgres has no rowid to look it up by.
    // `nationality`, not just `country`.
    //
    // `guests` has both columns and they mean different things: `nationality`
    // is citizenship, `country` is where the guest lives. Self-registration
    // collects citizenship and was writing it into `country` only, leaving
    // `guests.nationality` NULL — and `meldeschein.repo.ts` reads exactly
    // `g.nationality`. So the German registration form printed
    // «Staatsangehörigkeit» as MISSING for every guest who had just typed it
    // in, and the receptionist filled in by hand a field the guest had already
    // provided.
    //
    // Both are written: citizenship into its own column, and `country` kept as
    // it was so the guest list's country filter and the dedup path do not
    // change behaviour. Where the guest actually lives is a separate question
    // this form does not ask.
    insertGuest: `INSERT INTO guests (organization_id, first_name, last_name, date_of_birth, nationality, country, address, document_type, document_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    updateGuest: `UPDATE guests SET date_of_birth = COALESCE(?, date_of_birth), nationality = COALESCE(?, nationality), country = COALESCE(?, country), address = COALESCE(?, address), document_type = COALESCE(?, document_type), document_number = COALESCE(?, document_number), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    // Мети приїзду й номера візи тут більше НЕМАЄ: це факт ПЕРЕБУВАННЯ,
    // і він живе в книзі гостей (`reservation_guests`), звідки його читають реєстр
    // і кіоск. Друга копія тут розходилась із першою за шляхом реєстрації й
    // виходила назовні GDPR-експортом (`SELECT gr.*`).
    insertGr: `
      INSERT INTO guest_registrations (id, reservation_id, guest_id, is_primary, reg_status, registered_at, consent_given, consent_at, consent_ip)
      VALUES (?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(id) DO NOTHING`,
    updateGrCompleted: `
      UPDATE guest_registrations
      SET guest_id = ?, reg_status = 'completed', consent_given = 1, consent_at = CURRENT_TIMESTAMP, consent_ip = ?, registered_at = CURRENT_TIMESTAMP
      WHERE reservation_id = ? AND is_primary = ?`,
    findExistingGr: `SELECT id FROM guest_registrations WHERE reservation_id = ? AND is_primary = ?`,
  };

  await sql.tx(async (t) => {
    // Get reservation nights for fee calculation
    const reservation = await stayFacts(t, reservationId);
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
        await t.run(SQL.updateGuest, [guest.dateOfBirth ?? null, guest.nationality ?? null, guest.nationality ?? null, guest.address ?? null, guest.documentType ?? null, guest.documentNumber ?? null, guestId]);
      } else {
        const newGuest = await t.row<{ id: string }>(SQL.insertGuest, [organizationId, guest.firstName, guest.lastName, guest.dateOfBirth ?? null, guest.nationality ?? null, guest.nationality ?? null, guest.address ?? null, guest.documentType ?? null, guest.documentNumber ?? null]);
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
      // `guest.purposeOfStay || 'Tourism'` — той самий літерал, що стояв у
      // рецепції, тільки на другому шляху: гість, у якого форма не питає
      // мети, приходив у книгу для поліції «туристом». Не назвали —
      // ПОРОЖНЬО (гейт `purpose-of-stay.check`, вісь «названо/не названо»).
      await t.run(SQL.insertRg, [reservationId, guest.firstName, guest.lastName, guest.dateOfBirth ?? null, guest.address ?? null, guest.nationality ?? null, guest.documentType ?? null, guest.documentNumber ?? null, guestId, feeAmount, feeExempt, feeReason, guest.purposeOfStay?.trim() || null, guest.visaNumber?.trim() || null]);

      // Write to guest_registrations (dashboard view) — syncs data to PMS
      if (guestId) {
        const existingGr = await t.row<any>(SQL.findExistingGr, [reservationId, isPrimary]);
        if (existingGr) {
          // Draft exists — upgrade to completed
          await t.run(SQL.updateGrCompleted, [guestId, clientIp ?? null, reservationId, isPrimary]);
        } else {
          const grId = crypto.randomUUID();
          await t.run(SQL.insertGr, [grId, reservationId, guestId, isPrimary, clientIp ?? null]);
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

/** What one retention run did — and for how many tenants it could not run. */
export interface RetentionRunResult {
  /** reservation_guests rows anonymised: the per-stay registry copies. */
  registrations: number;
  /** guests profiles anonymised: people whose every stay is past the window. */
  guests: number;
  /** Organizations whose pass threw. Details are in the server log. */
  failedOrganizations: number;
}

/**
 * Anonymise identification data older than the retention window.
 *
 * The one implementation for both retention endpoints (api/guests/gdpr-cron
 * and api/cron/gdpr-retention). They used to carry two separate copies of
 * this logic, and the copies drifted until this one anonymised columns its
 * table does not have.
 *
 * 72 months by default: the Czech Evidenční kniha is kept six YEARS after
 * checkout — the same period the two-step erasure in gdpr.handlers.ts waits
 * out before touching identity. No default may be shorter; a shorter window
 * is something an operator typed on purpose (?months= on the cron endpoint).
 *
 * This function has failed silently twice, both times reporting a healthy
 * zero:
 *
 *   1. It ran on a bare connection — on Postgres the policies compared the
 *      tenant against an empty setting and every statement matched nothing.
 *   2. It UPDATEd `guest_registrations` SET first_name, email, phone —
 *      columns that table has never had on either engine (it is the consent
 *      log: reg_status, consent_*, and nothing identifying since 0416). Every
 *      engine refused every statement, the per-organization catch swallowed
 *      the error, and the cron answered { success: true, anonymizedCount: 0 }
 *      for every run.
 *
 * Identification lives on `reservation_guests` (the registry copy) and
 * `guests` (the profile). registration-retention.check.ts runs this function
 * against a real freshly-built database and fails on both regressions.
 */
export async function anonymizeOldRegistrations(monthsToKeep = 72): Promise<RetentionRunResult> {
  // retentionCutoff refuses a window that would put the cutoff in the future
  // and anonymise every guest in the database — see domain/retention.ts. The
  // throw is deliberate: this is the one operation with no undo, so a caller
  // that asked for something impossible should fail, not be corrected.
  const cutoff = retentionCutoff(monthsToKeep);
  const sql = getSql();

  const SQL = {
    // The registry copy, per stay: an old stay's row is anonymised even when
    // the same person stayed again recently — retention runs per record, not
    // per person. The column set is the one eraseGuestData clears.
    anonymizeRegistryRows: `
      UPDATE reservation_guests
      SET first_name = 'Anonymized',
          last_name = 'Anonymized',
          date_of_birth = NULL,
          document_type = NULL,
          document_number = NULL,
          nationality = NULL,
          address = NULL,
          visa_number = NULL,
          purpose_of_stay = NULL
      WHERE first_name != 'Anonymized'
        AND reservation_id IN (
          SELECT id FROM reservations WHERE check_out < ? AND organization_id = ?
        )`,
    // The consent log for those stays goes entirely: consent for data that no
    // longer exists proves nothing. Since 0416 it carries no identification of
    // its own either — purpose of stay and visa number live once, on the
    // registry row above, which the statement before this one clears.
    deleteConsentLog: `
      DELETE FROM guest_registrations
      WHERE reservation_id IN (
        SELECT id FROM reservations WHERE check_out < ? AND organization_id = ?
      )`,
    // The profile — only for someone whose EVERY stay is past the window, so
    // a returning guest keeps their record. Requiring an old stay to exist is
    // what keeps this off profiles with no stays at all: a guest typed in
    // yesterday has no checkout to age by, and "not found among recent stays"
    // alone would wipe them — that exact condition shipped once. Columns
    // follow eraseGuestData: whatsapp, city and nationality are cleared there
    // and were missing from the previous version of this statement.
    anonymizeGuestProfiles: `
      UPDATE guests
      SET first_name = 'Anonymized',
          last_name = 'Anonymized',
          date_of_birth = NULL,
          document_type = NULL,
          document_number = NULL,
          nationality = NULL,
          email = NULL,
          phone = NULL,
          whatsapp = NULL,
          city = NULL,
          country = NULL,
          address = NULL
      WHERE organization_id = ?
        AND first_name != 'Anonymized'
        AND (EXISTS (
               SELECT 1 FROM reservations r
               WHERE r.guest_id = guests.id AND r.check_out < ? AND r.organization_id = ?)
          OR EXISTS (
               SELECT 1 FROM reservation_guests rg
               JOIN reservations r ON r.id = rg.reservation_id
               WHERE rg.guest_id = guests.id AND r.check_out < ? AND r.organization_id = ?))
        AND NOT EXISTS (
          SELECT 1 FROM reservations r
          WHERE r.guest_id = guests.id AND r.check_out >= ?)
        AND NOT EXISTS (
          SELECT 1 FROM reservation_guests rg
          JOIN reservations r ON r.id = rg.reservation_id
          WHERE rg.guest_id = guests.id AND r.check_out >= ?)`,
  };

  // Walked per hotel, inside runWithOrganization, so the Postgres policies
  // see the tenant on the connection. The organization is named in every
  // statement as well: SQLite has no policies, and the wrapper alone would
  // let one hotel's pass anonymise every hotel's guests.
  const organizations = await sql.rows<{ id: string }>('SELECT id FROM organizations');
  const result: RetentionRunResult = { registrations: 0, guests: 0, failedOrganizations: 0 };

  for (const org of organizations) {
    try {
      const one = await runWithOrganization(org.id, () => sql.tx(async (t) => {
        const registry = await t.run(SQL.anonymizeRegistryRows, [cutoff, org.id]);
        await t.run(SQL.deleteConsentLog, [cutoff, org.id]);
        const profiles = await t.run(SQL.anonymizeGuestProfiles,
          [org.id, cutoff, org.id, cutoff, org.id, cutoff, cutoff]);
        return { registry: registry.changes, profiles: profiles.changes };
      }));
      result.registrations += one.registry;
      result.guests += one.profiles;
    } catch (error) {
      // One hotel's failure must not stop retention for the others — but it
      // must be countable. The two silent-zero regressions above survived
      // precisely because a swallowed error and "nothing was due" produced
      // the same answer; the caller now sees how many tenants failed, not
      // only how many rows moved.
      result.failedOrganizations += 1;
      console.error(`GDPR retention failed for organization ${org.id}:`, error);
    }
  }

  return result;
}
