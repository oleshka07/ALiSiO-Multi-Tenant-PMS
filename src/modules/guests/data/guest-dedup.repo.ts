/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';

export interface GuestDedupArgs {
  organizationId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  // Optional fields filled in / updated when creating or matching:
  address?: string | null;
  city?: string | null;
  country?: string | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
}

export interface GuestDedupResult {
  id: string;
  isNew: boolean;
  matchedBy: 'email' | 'phone' | 'name' | 'created';
}

/**
 * Unified guest dedup. Resolves a guest record using a priority chain:
 *
 *   1. email + organization_id              (highest signal — emails are unique-ish)
 *   2. phone + organization_id              (good signal when phone present)
 *   3. first_name + last_name (case-i.) + organization_id   (last resort)
 *
 * If none match, creates a new row. Optional fields fill in NULLs on the
 * existing row but never overwrite already-set data, so re-importing a guest
 * from a less-detailed source (e.g. Booking.com Excel without phone) cannot
 * wipe data set from a more detailed source (e.g. portal self-registration).
 *
 * Caller is responsible for providing a valid organizationId.
 */
export async function findOrCreateGuest(args: GuestDedupArgs): Promise<GuestDedupResult> {
  const sql = getSql();
  const orgId = args.organizationId;
  const firstName = (args.firstName || '').trim();
  const lastName = (args.lastName || '').trim();
  const email = args.email ? args.email.trim() : null;
  const phone = args.phone ? args.phone.trim() : null;

  const looksLikeRealEmail = (e: string | null) => !!e && /@/.test(e);
  const looksLikePhone = (p: string | null) => !!p && p.replace(/\D/g, '').length >= 6;

  let existing: any = null;
  let matchedBy: GuestDedupResult['matchedBy'] = 'created';

  if (looksLikeRealEmail(email)) {
    existing = await sql.row<any>('SELECT id FROM guests WHERE LOWER(email) = LOWER(?) AND organization_id = ? LIMIT 1', [email, orgId]);
    if (existing) matchedBy = 'email';
  }

  if (!existing && looksLikePhone(phone)) {
    existing = await sql.row<any>('SELECT id FROM guests WHERE phone = ? AND organization_id = ? LIMIT 1', [phone, orgId]);
    if (existing) matchedBy = 'phone';
  }

  if (!existing && firstName && lastName) {
    existing = await sql.row<any>('SELECT id FROM guests WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) AND organization_id = ? LIMIT 1', [firstName, lastName, orgId]);
    if (existing) matchedBy = 'name';
  }

  // Знайдений рядок міг бути ЗЛИТИЙ у когось (INC-300). Тоді це вже не людина,
  // а слід від неї, і чіпляти на нього нову бронь означало б відродити дублікат:
  // оператор побачив би, що злиття «не тримається».
  //
  // Ланцюга тут не розкручуємо і циклу не боїмось — його не буває за побудовою:
  // злиття перенацілює старі посилання, тож `merged_into` завжди веде на живого
  // ОДНИМ кроком (О303). Якби ланцюги були можливі, тут стояв би лічильник.
  if (existing) {
    const alive = await sql.row<any>(
      'SELECT id, merged_into FROM guests WHERE id = ? AND organization_id = ?',
      [existing.id, orgId]);
    if (alive?.merged_into) existing = { id: alive.merged_into };
  }

  if (existing) {
    // Soft-merge: only fill columns that are currently empty.
    const updates: string[] = [];
    const values: any[] = [];
    const fillIfEmpty = (col: string, val: string | null | undefined) => {
      if (val == null || val === '') return;
      updates.push(`${col} = COALESCE(NULLIF(${col}, ''), ?)`);
      values.push(val);
    };
    fillIfEmpty('email', email);
    fillIfEmpty('phone', phone);
    fillIfEmpty('address', args.address);
    fillIfEmpty('city', args.city);
    fillIfEmpty('country', args.country);
    fillIfEmpty('nationality', args.nationality);
    fillIfEmpty('date_of_birth', args.dateOfBirth);
    fillIfEmpty('document_type', args.documentType);
    fillIfEmpty('document_number', args.documentNumber);
    if (updates.length > 0) {
      updates.push("updated_at = CURRENT_TIMESTAMP");
      values.push(existing.id);
      await sql.run(`UPDATE guests SET ${updates.join(', ')} WHERE id = ?`, [...values]);
    }
    return { id: existing.id, isNew: false, matchedBy };
  }

  // Create new
  const guestId = `g_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await sql.run(`
    INSERT INTO guests (
      id, organization_id, first_name, last_name,
      email, phone, address, city, country, nationality,
      date_of_birth, document_type, document_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [guestId, orgId, firstName, lastName,
    email || null, phone || null, args.address || null, args.city || null, args.country || null, args.nationality || null,
    args.dateOfBirth || null, args.documentType || null, args.documentNumber || null]);
  return { id: guestId, isNew: true, matchedBy: 'created' };
}
