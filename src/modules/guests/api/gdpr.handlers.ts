/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '@core/db';
import { NextResponse } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { getOrgIdentity } from '@core/org-identity';

/**
 * Subject access and erasure under GDPR.
 *
 * Neither handler established a caller. exportGuestData took an id from the URL
 * and returned that person's entire file — profile, stays, registry entries,
 * consent log — so any logged-in user of any tenant could export any guest of
 * any hotel. A purpose-built personal-data export with no authorisation is the
 * worst shape this defect can take, and eraseGuestData had the same hole
 * pointing the other way.
 *
 * Both now require manage_guests, and the guest must belong to the caller's
 * organization. An id from another tenant answers 404, so the endpoint cannot
 * be used to discover which guests exist elsewhere.
 */

type IdParams = { params: Promise<{ id: string }> };

/** The guest row, but only if this organization holds it. */
function ownGuest(organizationId: string, id: string) {
  return getDb()
    .prepare('SELECT * FROM guests WHERE id = ? AND organization_id = ?')
    .get(id, organizationId) as any;
}

export const exportGuestData = withPermission('manage_guests', async (_request, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const db = getDb();

    const guest = ownGuest(actor.organizationId, id);
    if (!guest) return NextResponse.json({ error: 'Guest not found' }, { status: 404 });

    // Constrained through properties as well as by guest_id: a guest row and a
    // stay could otherwise disagree about who owns them.
    const bookings = db.prepare(`
      SELECT r.* FROM reservations r
      JOIN properties p ON p.id = r.property_id
      WHERE r.guest_id = ? AND p.organization_id = ?
    `).all(id, actor.organizationId) as any[];

    const registrations = db.prepare(`
      SELECT rg.* FROM reservation_guests rg
      JOIN reservations r ON r.id = rg.reservation_id
      JOIN properties p ON p.id = r.property_id
      WHERE rg.guest_id = ? AND p.organization_id = ?
    `).all(id, actor.organizationId) as any[];

    const consentLogs = db.prepare(`
      SELECT gr.* FROM guest_registrations gr
      JOIN reservations r ON r.id = gr.reservation_id
      JOIN properties p ON p.id = r.property_id
      WHERE gr.guest_id = ? AND p.organization_id = ?
    `).all(id, actor.organizationId) as any[];

    // The controller named in the export is the tenant. It used to be one
    // specific company, written into the source.
    const identity = getOrgIdentity(actor.organizationId);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      controller: {
        name: identity.name || null,
        registrationNo: identity.registrationNo || null,
        address: identity.legalAddress || null,
        email: identity.email || null,
      },
      guestProfile: guest,
      bookings,
      registrations,
      consentLogs,
    });
  } catch (error: any) {
    console.error('GDPR Export Error:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
});

export const eraseGuestData = withPermission('manage_guests', async (_request, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const db = getDb();

    if (!ownGuest(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
    }

    // Czech law requires the guest registry to be kept for six years after
    // checkout, so erasure is staged: contact details go now, identity fields
    // only once that period has passed.
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 6);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    let identityErased = false;

    db.transaction(() => {
      db.prepare(`
        UPDATE guests
        SET email = NULL,
            phone = NULL,
            updated_at = datetime('now')
        WHERE id = ? AND organization_id = ?
      `).run(id, actor.organizationId);

      const recentStays = db.prepare(`
        SELECT 1 FROM reservation_guests rg
        JOIN reservations r ON r.id = rg.reservation_id
        JOIN properties p ON p.id = r.property_id
        WHERE rg.guest_id = ? AND r.check_out >= ? AND p.organization_id = ?
        LIMIT 1
      `).get(id, cutoffStr, actor.organizationId);

      if (!recentStays) {
        db.prepare(`
          UPDATE guests
          SET first_name = 'Anonymized',
              last_name = 'Anonymized',
              date_of_birth = NULL,
              document_type = NULL,
              document_number = NULL,
              country = NULL,
              address = NULL
          WHERE id = ? AND organization_id = ?
        `).run(id, actor.organizationId);

        // The registry copy has to go too, or the identity survives there.
        db.prepare(`
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
          WHERE guest_id = ? AND reservation_id IN (
            SELECT r.id FROM reservations r
            JOIN properties p ON p.id = r.property_id
            WHERE p.organization_id = ?
          )
        `).run(id, actor.organizationId);

        identityErased = true;
      }
    })();

    // Say which of the two actually happened: "processed" alone left the
    // operator unable to answer a guest asking what was deleted.
    return NextResponse.json({
      success: true,
      contactDetailsErased: true,
      identityErased,
      message: identityErased
        ? 'Erasure complete.'
        : 'Contact details erased. Identity data is retained until the six-year registry retention period expires.',
      retentionUntil: identityErased ? null : cutoffStr,
    });
  } catch (error: any) {
    console.error('GDPR Erasure Error:', error);
    return NextResponse.json({ error: 'Erasure failed' }, { status: 500 });
  }
});
