import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withActor, type Actor } from '@core/auth/session';

/**
 * How many draft bookings are waiting, for the badge on the operator calendar
 * and in the sidebar.
 *
 * It sits under the '/api/booking/' public prefix — which exists for the
 * guest-facing widget — and had no session check and no organization filter, so
 * it counted every hotel's drafts and answered anyone who asked. Its callers
 * are the dashboard calendar and the sidebar, which always have a session.
 *
 * ── Чому це більше не «pool» ─────────────────────────────────────────────
 *
 * Рахувались броні, що стоять на юніті з `is_pool` — віртуальній кімнаті, куди
 * складали бронь, для якої номер ще не обрано (`reservations.unit_id` — NOT
 * NULL, тож без кімнати бронь не існує). Такий юніт створювався рівно в
 * одному місці: засівом для будови з кодом «F», тобто для одного клієнта.
 * Іншим готелям pool-юніта не заводив ніхто, і бейдж у них показував нуль
 * завжди — тоді як за ним ховались справжні чернетки, і клік вів на
 * `/app/bookings?status=draft`, де вони видно.
 *
 * Тепер рахується те саме, що показує сторінка за кліком: `status = 'draft'`.
 * Це працює в будь-якому готелі й без жодних віртуальних кімнат.
 */
export const GET = withActor(async (_req, _ctx, actor: Actor) => {
  const sql = getSql();
  // Excludes OTA/channel blocks: fake reservations injected by iCal that are
  // not real guests.
  const row = await sql.row<{ count: number }>(`
    SELECT COUNT(*) as count FROM reservations r
    JOIN guests g ON g.id = r.guest_id
    JOIN properties p ON p.id = r.property_id
    WHERE p.organization_id = ?
      AND r.status = 'draft'
      AND LOWER(g.first_name || ' ' || g.last_name) NOT LIKE '%ota%block%'
      AND LOWER(g.first_name || ' ' || g.last_name) NOT LIKE '%channel%block%'
  `, [actor.organizationId]);
  return NextResponse.json({ count: row?.count || 0 });
});

export const runtime = 'nodejs';
