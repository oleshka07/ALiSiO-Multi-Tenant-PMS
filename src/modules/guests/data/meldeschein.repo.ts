/**
 * The Meldeschein for one stay: who on it needs a form, and what goes on it.
 *
 * The rule — who registers and who no longer does — is in
 * ../domain/meldeschein.ts. Here there is only the fetching.
 *
 * Registered companions are read from `guest_registrations`, which the check-in
 * screen and the guest portal already fill. A stay with nobody registered still
 * produces a form for the main guest: that is the case reception is holding a
 * passport for, and an empty answer would be the least useful moment to give
 * one.
 */
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import {
  meldescheinNeeded, missingFields, retentionWindow,
  type MeldescheinData, type MeldescheinField,
} from '../domain/meldeschein';

export interface MeldescheinPerson extends MeldescheinData {
  guest_id: string;
  is_primary: boolean;
  required: boolean;
  reason: string;
  missing: MeldescheinField[];
}

export interface Meldeschein {
  reservation_id: string;
  property_name: string | null;
  property_address: string | null;
  property_city: string | null;
  property_country: string | null;
  unit_code: string | null;
  arrival: string;
  departure: string;
  /** Only the people who still have to register. */
  people: MeldescheinPerson[];
  /** Everyone the form deliberately skips, and why. */
  exempt: { guest_id: string; name: string; reason: string }[];
  keepUntil: string;
  destroyBy: string;
}

export async function meldescheinFor(reservationId: string): Promise<Meldeschein | null> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();

  const res = await sql.row<any>(
    `SELECT r.id, r.check_in, r.check_out, r.adults, r.children,
            u.code AS unit_code, u.name AS unit_name,
            p.name AS property_name, p.address AS property_address,
            p.city AS property_city, p.country AS property_country,
            g.id AS guest_id, g.first_name, g.last_name, g.date_of_birth,
            g.nationality, g.country, g.address, g.document_number
       FROM reservations r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN properties p ON p.id = r.property_id
       LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.id = ? AND r.organization_id = ?`,
    [reservationId, organizationId],
  );
  if (!res) return null;

  const arrival = day(res.check_in);
  const departure = day(res.check_out);

  // Everyone on the booking: the main guest, plus whoever was registered.
  const registered = await sql.rows<any>(
    `SELECT gr.is_primary, g.id AS guest_id, g.first_name, g.last_name,
            g.date_of_birth, g.nationality, g.address, g.document_number
       FROM guest_registrations gr
       JOIN guests g ON g.id = gr.guest_id
      WHERE gr.reservation_id = ?
      ORDER BY gr.is_primary DESC, gr.created_at`,
    [reservationId],
  );

  const everyone = registered.length > 0 ? registered : [{ ...res, is_primary: true }];

  const people: MeldescheinPerson[] = [];
  const exempt: Meldeschein['exempt'] = [];

  for (const person of everyone) {
    const need = meldescheinNeeded({
      propertyCountry: res.property_country,
      guestNationality: person.nationality,
    });
    const name = [person.first_name, person.last_name].filter(Boolean).join(' ') || '—';

    if (!need.required) {
      exempt.push({ guest_id: String(person.guest_id), name, reason: need.reason });
      continue;
    }

    // Companions are the OTHER people on the booking — the law asks for their
    // number, and the number on the form is the same for each person on it.
    const data: MeldescheinData = {
      arrival, departure,
      last_name: person.last_name || '',
      first_name: person.first_name || '',
      date_of_birth: person.date_of_birth ?? null,
      nationality: person.nationality ?? null,
      address: person.address ?? null,
      companions: Math.max(0, (Number(res.adults) || 0) + (Number(res.children) || 0) - 1),
      document_number: person.document_number ?? null,
    };

    people.push({
      ...data,
      guest_id: String(person.guest_id),
      is_primary: person.is_primary === true || Number(person.is_primary) === 1,
      required: true,
      reason: need.reason,
      missing: missingFields(data),
    });
  }

  const window = retentionWindow(departure);
  return {
    reservation_id: String(res.id),
    property_name: res.property_name ?? null,
    property_address: res.property_address ?? null,
    property_city: res.property_city ?? null,
    property_country: res.property_country ?? null,
    unit_code: res.unit_code || res.unit_name || null,
    arrival, departure, people, exempt,
    keepUntil: window.keepUntil,
    destroyBy: window.destroyBy,
  };
}

function day(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v ?? '').slice(0, 10);
}
