/**
 * The pre-arrival letter: register your guests before you get here.
 *
 * Runs once a day. For each hotel it finds the stays that start in the next
 * few days, skips the ones already written to and the ones whose guests are
 * already registered, and sends the letter in the GUEST's language
 * (send-guest-reminder-email.ts carries en / de / uk / cs).
 *
 * Three things were wrong with it, and the first made the other two moot.
 *
 * 1. It queried `reservations` with no organization set.
 *
 *    On SQLite that returned every hotel's bookings — one hotel's cron would
 *    have written to another's guests. On Postgres the row-level policy
 *    compares `organization_id` against a setting that was never made, so the
 *    query matched NOTHING. Production runs Postgres. The letter has never
 *    been sent, the cron reported `processed: 0` every day, and `0` is what a
 *    quiet morning looks like too.
 *
 *    Now it walks organizations and runs inside runWithOrganization(), the
 *    same shape as the daily digest.
 *
 * 2. It fired only on `check_in = today + 2`.
 *
 *    Miss one run — a restart, a deploy, an hour of downtime — and those
 *    guests never got a letter at all, because the day moved on. The window is
 *    now a range and the "already sent" marker is what stops repeats, so a
 *    missed day is caught up on the next one instead of being lost.
 *
 * 3. It wrote to guests who had already registered.
 *
 *    The letter asks for something already done, and the guest either ignores
 *    it or writes back confused. Both cost the hotel more than the letter saves.
 *
 * Unauthenticated, it was also a way for anyone to make the server send mail to
 * its guests. It now wants CRON_SECRET like every other cron here.
 */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { runWithOrganization } from '@core/auth/tenant-context';
import { sendGuestReminderEmail } from '@/modules/bookings/data/send-guest-reminder-email';
import { cronAuthFailure } from '@core/security/cron-auth';

export const dynamic = 'force-dynamic';

/** Written into internal_notes so a repeat run does not write twice. */
const MARKER = '[GUEST_REMINDER_SENT]';

/** A day, N days from today, as YYYY-MM-DD in UTC. */
const dayFromNow = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

export async function GET(request: Request) {
  // This is the one the audit reproduced: `Bearer local-cron` answered 200 on
  // the running build, and the route sends email to every arriving guest.
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const sql = getSql();
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  // Arriving tomorrow through three days out. Two days is the intent; the
  // range is what makes a missed run recoverable rather than lost.
  const from = dayFromNow(1);
  const to = dayFromNow(3);

  try {
    const organizations = await sql.rows<{ id: string; name: string }>(
      'SELECT id, name FROM organizations',
    );

    const results: { organization: string; sent: number; found: number; error?: string }[] = [];

    for (const org of organizations) {
      try {
        // One hotel's failure must not stop the others' letters.
        const outcome = await runWithOrganization(org.id, async () => {
          // `organization_id` named, not left to the policy.
          //
          // runWithOrganization() is what makes row-level security answer on
          // Postgres, and on SQLite it is only a value in async storage —
          // nothing rewrites the query. Without this line the first hotel in
          // the loop collected every hotel's arrivals and wrote to their
          // guests; the second then found nothing, because the letters were
          // already marked as sent. On a developer's machine that is the whole
          // isolation, and it read as "it works".
          const due = await sql.rows<{ id: string }>(
            `SELECT r.id
               FROM reservations r
              WHERE r.organization_id = ?
                AND r.status = 'confirmed'
                AND r.check_in >= ? AND r.check_in <= ?
                AND COALESCE(r.notes, '') NOT LIKE '%document_strategy:reception%'
                AND COALESCE(r.internal_notes, '') NOT LIKE ?
                -- Everyone on the booking already registered: the letter would
                -- ask for something that is done.
                AND (SELECT COUNT(*) FROM guest_registrations gr WHERE gr.reservation_id = r.id)
                    < (COALESCE(r.adults, 1) + COALESCE(r.children, 0))
              ORDER BY r.check_in`,
            [org.id, from, to, `%${MARKER}%`],
          );

          let sent = 0;
          for (const res of due) {
            if (!await sendGuestReminderEmail(res.id, origin)) continue;
            // Marked only after the letter actually left, so a send that fails
            // is retried tomorrow rather than silently dropped.
            await sql.run(
              `UPDATE reservations
                  SET internal_notes = COALESCE(internal_notes, '') || ?
                WHERE id = ? AND organization_id = ?`,
              [`\n${MARKER}`, res.id, org.id],
            );
            sent++;
          }
          return { sent, found: due.length };
        });

        results.push({ organization: org.name, ...outcome });
        if (outcome.found) console.log(`[GuestReminders] ${org.name}: ${outcome.sent}/${outcome.found}`);
      } catch (e: any) {
        results.push({ organization: org.name, sent: 0, found: 0, error: e?.message });
        console.error(`[GuestReminders] ${org.name} failed:`, e?.message);
      }
    }

    return NextResponse.json({
      ok: true,
      window: { from, to },
      organizations: results.length,
      sent: results.reduce((n, r) => n + r.sent, 0),
      results,
    });
  } catch (error: any) {
    console.error('[GuestReminders] Error:', error?.message || error);
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }
}
