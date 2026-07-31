/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import bcrypt from 'bcryptjs';
import { sendBookingConfirmationEmail } from '../data/send-confirmation-email';

/**
 * Which hotel this booking is for.
 *
 * The endpoint is public — the embedded widget calls it from the customer's
 * own website with no session — so the tenant has to come from the request.
 * The embed script identifies itself with data-site, which arrives here as
 * site_slug or site_id; property_id is accepted for direct integrations.
 *
 * It used to read `SELECT id, organization_id FROM properties LIMIT 1`, which
 * on a shared server files a guest, a reservation and a payment against
 * whichever hotel the server created first.
 */
function resolveTarget(db: any, body: any): { id: string; organization_id: string } | null {
  if (body.property_id) {
    return db.prepare('SELECT id, organization_id FROM properties WHERE id = ? AND is_active = 1')
      .get(body.property_id) ?? null;
  }
  const site = body.site_id || body.site_slug;
  if (!site) return null;
  return db.prepare(`
    SELECT p.id, p.organization_id
    FROM booking_sites s
    JOIN properties p ON p.id = s.property_id
    WHERE (s.id = ? OR s.slug = ?) AND s.status != 'deleted'
  `).get(site, site) ?? null;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function createBookingDraftOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── Helper: generate a short token ─────────────────────────────────────────
function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function genToken(len = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ─── POST — create draft + real PMS reservation ──────────────────────────────
export async function createBookingDraft(req: Request) {
  try {
    const body = await req.json();
    const db = getDb();

    const draftId = genId('bkd');
    const sessionId = body.session_id || genId('sess');

    const property = resolveTarget(db, body);
    if (!property) {
      return NextResponse.json(
        { error: 'site_slug, site_id or property_id is required' },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // 1. Save booking_draft (always — as a log)
    db.prepare(`
      INSERT INTO booking_drafts (id, organization_id, session_id, accommodation_type, unit_type, check_in, check_out,
        adults, children, extras, options, guest_name, guest_email, guest_phone,
        total_price, deposit_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(
      draftId, property.organization_id, sessionId,
      body.accommodation_type || null,
      body.accommodation_data?.unit || body.accommodation_data?.building || null,
      body.check_in || null,
      body.check_out || null,
      body.accommodation_data?.adults || 1,
      body.accommodation_data?.children || 0,
      JSON.stringify(body.extras || []),
      JSON.stringify(body.accommodation_data || {}),
      body.guest_name || null,
      body.guest_email || null,
      body.guest_phone || null,
      body.total_price || 0,
      body.deposit_amount || 0,
    );

    // 2. Find or create Guest in PMS
    const [firstName, ...rest] = (body.guest_name || 'Guest').trim().split(' ');
    const lastName = rest.join(' ') || '';

    let guestId: string | null = null;

    // ⚠️ Widget bookings ALWAYS create a new guest record.
    // We intentionally do NOT look up by email here — reusing an existing
    // guest by email caused one person's name (e.g. "Lukeš Jaroslav") to
    // appear on completely different guests' bookings whenever the same
    // e-mail was entered for multiple people.
    // A staff member can later merge duplicate guest profiles in the PMS.
    guestId = genId('g');
    db.prepare(`
      INSERT INTO guests (id, organization_id, first_name, last_name, email, phone, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'widget', datetime('now'))
    `).run(guestId, property.organization_id, firstName, lastName, body.guest_email || null, body.guest_phone || null);


    // 3. Find a suitable unit
    const accommodationType: string = body.accommodation_type || 'camping';
    let unitId: string | null = null;

    if (accommodationType === 'camping') {
      const checkIn  = body.check_in  || null;
      const checkOut = body.check_out || null;

      // Pick the first camping unit that has NO overlapping active reservation.
      // Overlap condition: existing.check_in < new.check_out AND existing.check_out > new.check_in
      const campingUnit = (checkIn && checkOut)
        ? db.prepare(`
            SELECT u.id FROM units u
            JOIN unit_types ut ON u.unit_type_id = ut.id
            WHERE u.property_id = ? AND u.is_active = 1
              AND (LOWER(ut.code) LIKE '%camp%' OR LOWER(ut.name) LIKE '%camp%'
                   OR LOWER(u.name) LIKE '%camp%' OR LOWER(ut.code) = 'bb'
                   OR LOWER(ut.code) = 'fr' OR LOWER(ut.code) = 'br')
              AND NOT EXISTS (
                SELECT 1 FROM reservations r
                WHERE r.unit_id = u.id
                  AND r.status NOT IN ('cancelled', 'no_show')
                  AND r.check_in  < ?
                  AND r.check_out > ?
              )
            ORDER BY u.sort_order, u.name
            LIMIT 1
          `).get(property.id, checkOut, checkIn) as any
        : db.prepare(`
            SELECT u.id FROM units u
            JOIN unit_types ut ON u.unit_type_id = ut.id
            WHERE u.property_id = ? AND u.is_active = 1
              AND (LOWER(ut.code) LIKE '%camp%' OR LOWER(ut.name) LIKE '%camp%'
                   OR LOWER(u.name) LIKE '%camp%' OR LOWER(ut.code) = 'bb'
                   OR LOWER(ut.code) = 'fr' OR LOWER(ut.code) = 'br')
            ORDER BY u.sort_order, u.name
            LIMIT 1
          `).get(property.id) as any;

      // Fallback: if all camping units are occupied (or only 1 exists), just grab the first one
      // so the booking still goes through and staff can sort it out in PMS.
      if (!campingUnit && (checkIn && checkOut)) {
        const fallbackCamping = db.prepare(`
          SELECT u.id FROM units u
          JOIN unit_types ut ON u.unit_type_id = ut.id
          WHERE u.property_id = ? AND u.is_active = 1
            AND (LOWER(ut.code) LIKE '%camp%' OR LOWER(ut.name) LIKE '%camp%'
                 OR LOWER(u.name) LIKE '%camp%' OR LOWER(ut.code) = 'bb'
                 OR LOWER(ut.code) = 'fr' OR LOWER(ut.code) = 'br')
          ORDER BY u.sort_order, u.name LIMIT 1
        `).get(property.id) as any;
        unitId = fallbackCamping?.id || null;
        console.warn('[BookingDraft] All camping units occupied — using first unit as fallback');
      } else {
        unitId = campingUnit?.id || null;
      }
    } else if (accommodationType === 'glamping') {
      const unitCode = (body.accommodation_data?.unit === 'barn') ? 'barn' : 'tiny';
      const glamUnit = db.prepare(`
        SELECT u.id FROM units u
        JOIN unit_types ut ON u.unit_type_id = ut.id
        WHERE u.property_id = ? AND u.is_active = 1
          AND (LOWER(ut.code) LIKE '%glamp%' OR LOWER(ut.name) LIKE '%glamp%'
               OR LOWER(u.name) LIKE ? OR LOWER(ut.code) LIKE ?)
        ORDER BY u.sort_order LIMIT 1
      `).get(property.id, `%${unitCode}%`, `%${unitCode}%`) as any;
      unitId = glamUnit?.id || null;
    } else if (accommodationType === 'buildings') {
      const bld = body.accommodation_data?.building === 'budova_f' ? 'bldg_f' : 'bldg_d';
      const checkIn  = body.check_in  || null;
      const checkOut = body.check_out || null;

      const buildingUnit = (checkIn && checkOut)
        ? db.prepare(`
            SELECT u.id FROM units u
            WHERE u.property_id = ? AND u.is_active = 1
              AND u.building_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM reservations r
                WHERE r.unit_id = u.id
                  AND r.status NOT IN ('cancelled', 'no_show')
                  AND r.check_in  < ?
                  AND r.check_out > ?
              )
            ORDER BY u.sort_order, u.name
            LIMIT 1
          `).get(property.id, bld, checkOut, checkIn) as any
        : db.prepare(`
            SELECT u.id FROM units u
            WHERE u.property_id = ? AND u.is_active = 1
              AND u.building_id = ?
            ORDER BY u.sort_order, u.name
            LIMIT 1
          `).get(property.id, bld) as any;

      if (!buildingUnit) {
        const fallbackBld = db.prepare(`
          SELECT u.id FROM units u
          WHERE u.property_id = ? AND u.is_active = 1 AND u.building_id = ?
          ORDER BY u.sort_order, u.name LIMIT 1
        `).get(property.id, bld) as any;
        unitId = fallbackBld?.id || null;
      } else {
        unitId = buildingUnit.id;
      }
    }

    // Ultimate fallback: any unit at all (so we never fail with NOT NULL constraint)
    if (!unitId) {
      const anyUnit = db.prepare(`SELECT id FROM units WHERE property_id = ? AND is_active = 1 ORDER BY sort_order LIMIT 1`).get(property.id) as any;
      unitId = anyUnit?.id || null;
    }

    // If still no unit — abort gracefully (return draft without PMS reservation)
    if (!unitId) {
      console.warn('[BookingDraft] No units found — returning draft only');
      db.prepare(`UPDATE booking_drafts SET guest_page_token = ? WHERE id = ?`).run(genToken(32), draftId);
      const d = db.prepare('SELECT * FROM booking_drafts WHERE id = ?').get(draftId) as any;
      return NextResponse.json({ id: draftId, session_id: sessionId, reservation_id: null, guest_page_token: d?.guest_page_token }, { headers: CORS_HEADERS });
    }

    // 4. Calculate nights
    const nights = (() => {
      if (!body.check_in || !body.check_out) return 1;
      const d1 = new Date(body.check_in);
      const d2 = new Date(body.check_out);
      return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000));
    })();

    // 5. Create Reservation in PMS
    const reservationId = genId('r');
    const guestPageToken = genToken(32);

    const utmParams = body.utm_params || {};
    const utmSource = utmParams['utm_source'] || null;
    const utmMedium = utmParams['utm_medium'] || null;
    const utmCampaign = utmParams['utm_campaign'] || null;
    const utmContent = utmParams['utm_content'] || null;
    const utmTerm = utmParams['utm_term'] || null;
    const gaClientId = utmParams['ga_client_id'] || null;

    const draftSource = body.site_id ? `widget:${body.site_id}` : 'widget';

    const refUrl = body.source_url || 'Прямий захід';
    const ua = body.user_agent || '';
    const browser = ua.includes('Chrome') ? 'Chrome' : ua.includes('Safari') && !ua.includes('Chrome') ? 'Safari' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Edge') ? 'Edge' : 'Інший';
    const device = ua.includes('Mobile') ? 'Mobile' : 'Desktop';
    
    let marketingNotes = `🌐 Джерело: ${refUrl}\n`;
    marketingNotes += `💻 Пристрій: ${device} · ${browser}\n`;
    if (body.language || body.time_zone) {
      marketingNotes += `🌍 Мова/Локація: ${body.language || '?'} · ${body.time_zone || '?'}\n`;
    }
    if (body.accommodation_data) {
      marketingNotes += `ℹ️ Опції: ${JSON.stringify(body.accommodation_data)}`;
    }

    db.prepare(`
      INSERT INTO reservations (
        id, property_id, unit_id, guest_id, source,
        check_in, check_out, nights,
        adults, children,
        total_price, currency,
        status, payment_status,
        guest_page_token,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term, ga_client_id,
        notes, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, 'CZK',
        'tentative', 'unpaid',
        ?,
        ?, ?, ?, ?, ?, ?,
        ?, datetime('now'), datetime('now')
      )
    `).run(
      reservationId,
      property.id,
      unitId,
      guestId,
      draftSource,
      body.check_in || null,
      body.check_out || null,
      nights,
      body.accommodation_data?.adults || 1,
      body.accommodation_data?.children || 0,
      body.total_price || 0,
      guestPageToken,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm, gaClientId,
      marketingNotes,
    );

    // Link draft → reservation + save token in draft
    db.prepare(`UPDATE booking_drafts SET reservation_id = ?, guest_page_token = ? WHERE id = ?`).run(reservationId, guestPageToken, draftId);

    // 6. Create service_orders for extras
    const extras: any[] = body.extras || [];
    for (const extra of extras) {
      if (!extra.id || !extra.price) continue;
      const orderId = genId('so');
      try {
        db.prepare(`
          INSERT INTO service_orders (
            id, reservation_id, service_id, quantity, total_price,
            status, payment_status, service_date, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', 'unpaid', ?, 'Booked via widget', datetime('now'))
        `).run(orderId, reservationId, extra.id, extra.quantity || 1, extra.price || 0, body.check_in || null);
      } catch (e: any) {
        // service_orders table might use different schema — try booking_service_orders
        try {
          db.prepare(`
            INSERT INTO booking_service_orders (
              id, reservation_id, service_id, quantity, unit_price, total_price,
              status, payment_status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'unpaid', datetime('now'))
          `).run(orderId, reservationId, extra.id, extra.quantity || 1,
            (extra.price / (extra.quantity || 1)) || 0, extra.price || 0);
        } catch { /* ignore if neither table exists */ }
      }
    }

    console.log(`[BookingDraft] Created draft=${draftId} reservation=${reservationId} guest=${guestId}`);

    return NextResponse.json({
      id: draftId,
      session_id: sessionId,
      reservation_id: reservationId,
      guest_page_token: guestPageToken,
    }, { headers: CORS_HEADERS });

  } catch (err: any) {
    console.error('[BookingDraft] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}

// ─── PUT — admin confirm payment ─────────────────────────────────────────────
/**
 * The PIN a receptionist enters to confirm a cash or terminal payment.
 *
 * It used to be four hard-coded four-digit numbers in this file, mapped to the
 * names of the original hotel's staff and to their personal cash accounts. On
 * a shared server that means one hotel's PIN marks any other hotel's
 * reservation as paid — this endpoint is public, serves
 * Access-Control-Allow-Origin: *, and takes the reservation id from the
 * request.
 *
 * The PIN is a staff credential, so it lives on the staff row, which already
 * carries both the organization and the cash account the payment should be
 * routed to. It is checked only against the organization that owns the
 * reservation being confirmed.
 */
function staffForPin(db: any, organizationId: string, pin: string):
  { name: string; cashAccountId: string | null } | null {
  const candidates = db.prepare(`
    SELECT full_name, payment_pin_hash, default_cash_account_id
    FROM app_users
    WHERE organization_id = ? AND is_active = 1 AND payment_pin_hash IS NOT NULL
  `).all(organizationId) as any[];

  for (const u of candidates) {
    if (bcrypt.compareSync(pin, u.payment_pin_hash)) {
      return { name: u.full_name, cashAccountId: u.default_cash_account_id ?? null };
    }
  }
  return null;
}

/** The organization that owns a reservation, through its property. */
function organizationOfReservation(db: any, reservationId: string): string | null {
  const row = db.prepare(`
    SELECT p.organization_id AS org
    FROM reservations r JOIN properties p ON p.id = r.property_id
    WHERE r.id = ?
  `).get(reservationId) as any;
  return row?.org ?? null;
}

export async function updateBookingDraft(req: Request) {
  try {
    const body = await req.json();
    const db = getDb();
    const { id, status, reservation_id: directResId, admin_pin, payment_method } = body;
    const isTerminal = payment_method === 'terminal';
    if (!id && !directResId) return NextResponse.json({ error: 'Missing id or reservation_id' }, { status: 400, headers: CORS_HEADERS });

    // The PIN is validated below, once the reservation — and so the
    // organization whose staff may confirm it — is known.
    let adminName: string | null = null;
    let adminCashAccountId: string | null = null;
    if (status === 'paid' && !admin_pin) {
      return NextResponse.json({ error: 'PIN required', code: 'PIN_REQUIRED' }, { status: 401, headers: CORS_HEADERS });
    }

    // ─── Resolve reservation ID ────────────────────────────────────────────
    let rid: string | null = directResId || null;
    if (!rid && id) {
      const draft = db.prepare('SELECT reservation_id FROM booking_drafts WHERE id = ?').get(id) as any;
      rid = draft?.reservation_id || null;
      if (!rid) {
        const res = db.prepare('SELECT id FROM reservations WHERE id = ?').get(id) as any;
        rid = res?.id || null;
      }
    }

    // ─── Confirm payment ───────────────────────────────────────────────────
    if (status === 'paid' && rid) {
      const organizationId = organizationOfReservation(db, rid);
      if (!organizationId) {
        return NextResponse.json({ error: 'Reservation not found' }, { status: 404, headers: CORS_HEADERS });
      }
      const staff = staffForPin(db, organizationId, String(admin_pin).trim());
      if (!staff) {
        console.warn(`[AdminConfirm] Invalid PIN attempt on ${rid}: ${String(admin_pin).substring(0, 2)}**`);
        return NextResponse.json(
          { error: 'Невірний PIN-код. Зверніться до адміністратора.', code: 'WRONG_PIN' },
          { status: 401, headers: CORS_HEADERS },
        );
      }
      adminName = staff.name;
      adminCashAccountId = staff.cashAccountId;

      const now = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Prague' });
      const note = isTerminal
        ? `💳 Оплата терміналом, прийняв: ${adminName} · ${now}`
        : `✅ Готівку прийняв: ${adminName} · ${now}`;

      // Guard: only update if not already paid. Lets us detect first-time
      // confirmation and avoid double-sending confirmation emails on a
      // duplicate PIN submit.
      const confirmResult = db.prepare(`
        UPDATE reservations
        SET payment_status = 'paid',
            status = 'confirmed',
            internal_notes = CASE
              WHEN internal_notes IS NULL OR internal_notes = '' THEN ?
              ELSE internal_notes || char(10) || ?
            END,
            updated_at = datetime('now')
        WHERE id = ? AND payment_status != 'paid'
      `).run(note, note, rid);

      try { db.prepare(`UPDATE service_orders SET payment_status = 'paid', status = 'confirmed' WHERE reservation_id = ? AND payment_status != 'paid'`).run(rid); } catch { /* */ }
      try { db.prepare(`UPDATE booking_service_orders SET payment_status = 'paid', status = 'confirmed' WHERE reservation_id = ? AND payment_status != 'paid'`).run(rid); } catch { /* */ }

      // First-time confirmation: create fin_operation + send email + notify TG.
      if (confirmResult.changes > 0) {
        // Emit payment status change for TG notification editing
        import('@core/event-bus').then(({ eventBus }) => {
          eventBus.emit('booking.payment_status_changed', {
            bookingId: rid,
            oldStatus: 'unpaid',
            newStatus: 'paid',
          });
        }).catch(() => {});
        // ─── Create fin_operation ONLY for CASH payments ──────────────────
        // Terminal payments do NOT get a fin_operation here — the money
        // arrives via bank statement and will be recorded through bank import.
        // Cash must be tracked immediately because there's no bank trail.
        if (!isTerminal) {
          try {
            const { createPaymentOperation, hasPaymentOperation } = await import('../../finance/api/payment-bridge');
            // Prevent double-creation if widget retries
            if (!hasPaymentOperation(rid, 'booking_widget', `pin_${rid}`)) {
              const reservation = db.prepare('SELECT total_price, currency FROM reservations WHERE id = ?').get(rid) as any;
              const amount = reservation?.total_price || 0;
              const currency = reservation?.currency || 'CZK';

              // The cash goes to the account on the staff row the PIN matched.
              const accountId: string | undefined = adminCashAccountId ?? undefined;
              if (!accountId) console.warn(`[AdminConfirm] ${adminName} has no cash account set`);

              if (amount > 0) {
                createPaymentOperation({
                  reservationId: rid,
                  amount,
                  currency,
                  method: 'cash',
                  paymentSubtype: 'full',
                  source: 'booking_widget',
                  sourceRef: `pin_${rid}`,
                  accountId,
                  comment: `Готівка (віджет) · Внесено: ${adminName || 'Admin'}`,
                  // The PIN itself must not end up in the operation trail.
                  actor: { id: `staff:${adminName}`, name: adminName || 'Admin' },
                });
                console.log(`[CashConfirm] Created fin_operation for ${rid}, account=${accountId || 'fallback'}, amount=${amount} ${currency}`);
              }
            }
          } catch (e: any) {
            console.error('[AdminConfirm] fin_operation creation error (non-fatal):', e.message);
          }
        } else {
          console.log(`[TerminalConfirm] Skipping fin_operation for ${rid} — terminal payment will arrive via bank statement`);
        }

        // Fire confirmation email
        const origin = (() => {
          try {
            const proto = req.headers.get('x-forwarded-proto') || 'https';
            const host = req.headers.get('host') || '';
            return host ? `${proto}://${host}` : undefined;
          } catch { return undefined; }
        })();
        sendBookingConfirmationEmail(rid, origin).catch((e) => {
          console.error('[AdminConfirm] Email send error:', e?.message);
        });
      }

      // ─── Audit log ──────────────────────────────────────────────────────
      try {
        const orgId = organizationId;
        const auditAction = isTerminal ? 'terminal_payment_confirmed' : 'cash_payment_confirmed';
        db.prepare(`
          INSERT INTO audit_log (organization_id, action, entity_type, entity_id, new_values, created_at)
          VALUES (?, ?, 'reservation', ?, ?, datetime('now'))
        `).run(orgId, auditAction, rid, JSON.stringify({ confirmed_by: adminName, reservation_id: rid, status: 'paid', payment_method: payment_method || 'cash' }));
      } catch { /* audit_log might not exist */ }

      const logPrefix = isTerminal ? '[TerminalConfirm]' : '[CashConfirm]';
      console.log(`${logPrefix} Reservation ${rid} confirmed by ${adminName}`);
    }

    // ─── Update draft status ───────────────────────────────────────────────
    // BookingWizard sends reservation_id as `id`, so try both draft.id and
    // draft.reservation_id to make sure the draft row gets updated.
    if (id) {
      try {
        const result = db.prepare(`UPDATE booking_drafts SET status = ? WHERE id = ?`).run(status, id);
        if (result.changes === 0) {
          db.prepare(`UPDATE booking_drafts SET status = ? WHERE reservation_id = ?`).run(status, id);
        }
      } catch { /* */ }
    }
    if (rid && rid !== id) {
      try { db.prepare(`UPDATE booking_drafts SET status = ? WHERE reservation_id = ?`).run(status, rid); } catch { /* */ }
    }

    return NextResponse.json({ ok: true, reservation_id: rid, admin_name: adminName }, { headers: CORS_HEADERS });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────────
// Returns the draft joined with the linked reservation so the widget can
// poll `payment_status` (e.g. while the QR-payment modal is open).
export async function getBookingDraft(req: Request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');
    const id = searchParams.get('id');
    const reservationId = searchParams.get('reservation_id');

    const baseSql = `
      SELECT bd.*,
             r.payment_status AS reservation_payment_status,
             r.status        AS reservation_status
      FROM booking_drafts bd
      LEFT JOIN reservations r ON bd.reservation_id = r.id
    `;

    let draft: any;
    if (reservationId) {
      draft = db.prepare(`${baseSql} WHERE bd.reservation_id = ? ORDER BY bd.created_at DESC LIMIT 1`).get(reservationId);
      // Fallback: caller passed a reservation_id with no linked draft (e.g.
      // dev/test data). Surface the reservation state directly.
      if (!draft) {
        const r = db.prepare('SELECT id, payment_status, status FROM reservations WHERE id = ?').get(reservationId) as any;
        if (r) {
          draft = {
            reservation_id: r.id,
            reservation_payment_status: r.payment_status,
            reservation_status: r.status,
          };
        }
      }
    } else if (sessionId) {
      draft = db.prepare(`${baseSql} WHERE bd.session_id = ?`).get(sessionId);
    } else if (id) {
      draft = db.prepare(`${baseSql} WHERE bd.id = ?`).get(id);
    }

    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404, headers: CORS_HEADERS });
    }

    return NextResponse.json(draft, { headers: CORS_HEADERS });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
export async function deleteBookingDraft(req: Request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400, headers: CORS_HEADERS });

    db.prepare('DELETE FROM booking_drafts WHERE id = ?').run(id);
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}
