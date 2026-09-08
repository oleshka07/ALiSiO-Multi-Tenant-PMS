/**
 * What each channel's price includes, and what we add on top.
 *
 * Owner-only — through the finance module's own guard, which is where that
 * policy is defined. It used to be `withOwner`, which also admits a director
 * and asks neither the finance step-up passphrase nor a restricted finance
 * user's read-only flag: the file said owner-only and the guard did not.
 *
 * Whether Booking.com's figure contains breakfast, and how that breakfast
 * divides between food and drink, decides what VAT the hotel declares on every
 * channel booking it takes. That is a statement to a tax office, not a
 * reception setting.
 *
 * The tax roles are chosen, never the percentages: a rate written here as 7
 * would still say 7 after the next change, and the whole point of fin_tax_rates
 * is that a rate has dates.
 */
/**
 * Варта — у фасаді (`api/index.ts`), не тут.
 *
 * Раніше тут стояли `withFinanceRead` / `withFinanceWrite` з `_guard`, а той
 * тримається на фінансовому PIN (`finance_security`). PIN писався, щоб
 * сховати від персоналу прибуток і витрати — і для ставок ПДВ це
 * неправильна варта двічі: по-перше, вона вимагає від рецепції PIN власника
 * там, де та просто виписує документ; по-друге, вона лишає фактурування
 * привʼязаним до модуля обліку, який має вимикатись окремо.
 *
 * Тепер тут звичайні функції, а `withModule('invoicing', …)` у фасаді
 * питає три речі одразу: хто це, чи має право, і чи є в готеля цей модуль.
 */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withPermission } from '@core/auth/session';
import { requireOrganizationId, requirePropertyId } from '@core/auth/tenant-context';
import { handleError } from '@core/http/errors';
import { postStayCharges, postServiceCharges } from '../data/stay-charges.repo';

const CODES = ['standard', 'reduced', 'zero'];
const isCode = (v: unknown): v is string => typeof v === 'string' && CODES.includes(v);

export const listChannelRules = async (request: Request) => {
  const organizationId = await requireOrganizationId();
  try {
    const propertyId = await requirePropertyId(new URL(request.url).searchParams.get('property_id'));
    const rules = await getSql().rows<any>(
      `SELECT id, channel, includes_breakfast, breakfast_food_price, breakfast_drinks_price,
              lodging_tax_code, food_tax_code, drinks_tax_code, markup_percent
         FROM channel_rate_rules
        WHERE organization_id = ? AND property_id = ?
        ORDER BY channel NULLS FIRST`,
      [organizationId, propertyId],
    );
    return NextResponse.json({ rules, property_id: propertyId });
  } catch (e) {
    return handleError('invoicing/channel-rules', e);
  }
};

export const saveChannelRule = async (request: Request) => {
  const body = await request.json().catch(() => null) as any;

  // Empty means "any channel" — the default rule. A hotel with one arrangement
  // writes one row, and that is the common case.
  const channel = typeof body?.channel === 'string' && body.channel.trim()
    ? body.channel.trim().toLowerCase() : null;

  const food = Number(body?.breakfast_food_price ?? 0);
  const drinks = Number(body?.breakfast_drinks_price ?? 0);
  if (!Number.isFinite(food) || food < 0 || !Number.isFinite(drinks) || drinks < 0) {
    return NextResponse.json({ error: 'Breakfast prices must be zero or more' }, { status: 400 });
  }
  const markup = Number(body?.markup_percent ?? 0);
  // Below −100 % the channel would owe the hotel money for the privilege.
  if (!Number.isFinite(markup) || markup < -100 || markup > 900) {
    return NextResponse.json({ error: 'Markup must be between -100 and 900 percent' }, { status: 400 });
  }
  for (const key of ['lodging_tax_code', 'food_tax_code', 'drinks_tax_code']) {
    if (body[key] != null && !isCode(body[key])) {
      return NextResponse.json({ error: `${key} must be standard, reduced or zero` }, { status: 400 });
    }
  }

  const includes = body?.includes_breakfast ? 'TRUE' : 'FALSE';

  try {
    const organizationId = await requireOrganizationId();
    const propertyId = await requirePropertyId(body?.property_id);
    const sql = getSql();

    // One rule per channel. Asked before writing rather than caught after: the
    // unique index reports its own name, and "idx_channel_rate_rules_row" is
    // not a sentence to show an operator.
    const existing = await sql.row<any>(
      `SELECT id FROM channel_rate_rules
        WHERE organization_id = ? AND property_id = ? AND COALESCE(channel, '') = COALESCE(?, '')`,
      [organizationId, propertyId, channel],
    );

    if (existing) {
      await sql.run(
        `UPDATE channel_rate_rules
            SET includes_breakfast = ${includes}, breakfast_food_price = ?, breakfast_drinks_price = ?,
                lodging_tax_code = ?, food_tax_code = ?, drinks_tax_code = ?, markup_percent = ?,
                updated_at = ?
          WHERE id = ? AND organization_id = ?`,
        [food, drinks, body.lodging_tax_code || 'reduced', body.food_tax_code || 'reduced',
         body.drinks_tax_code || 'standard', markup, nowIso(), existing.id, organizationId],
      );
      return NextResponse.json({ id: existing.id });
    }

    const id = crypto.randomUUID();
    await sql.run(
      `INSERT INTO channel_rate_rules
         (id, organization_id, property_id, channel, includes_breakfast,
          breakfast_food_price, breakfast_drinks_price,
          lodging_tax_code, food_tax_code, drinks_tax_code, markup_percent)
       VALUES (?, ?, ?, ?, ${includes}, ?, ?, ?, ?, ?, ?)`,
      [id, organizationId, propertyId, channel, food, drinks,
       body.lodging_tax_code || 'reduced', body.food_tax_code || 'reduced',
       body.drinks_tax_code || 'standard', markup],
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return handleError('invoicing/channel-rules', e);
  }
};

export const deleteChannelRule = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const organizationId = await requireOrganizationId();
  const res = await getSql().run(
    'DELETE FROM channel_rate_rules WHERE id = ? AND organization_id = ?', [id, organizationId]);
  if (res.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
};

/**
 * Post a stay's charges onto a folio, split by the rules.
 *
 * `manage_documents`, unlike the settings above: this is the button reception
 * presses when a guest arrives at the desk, and the arithmetic it runs is the
 * one they would otherwise do on paper.
 */
export const postStayChargesToFolio = withPermission('manage_documents', async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await request.json().catch(() => null) as any;
  if (!body?.reservation_id) {
    return NextResponse.json({ error: 'reservation_id is required' }, { status: 400 });
  }

  // The room and the services are posted independently, and that is the point:
  // the room is known when the booking lands, the sauna is ordered on the
  // second evening. Pressing this again after a new order must add that order,
  // not refuse because the room is already there.
  const room = await postStayCharges({ folioId: id, reservationId: body.reservation_id });
  const services = await postServiceCharges({ folioId: id, reservationId: body.reservation_id });

  // `already_posted` on the room is not a failure when a service still went on.
  const roomFailed = 'reason' in room && room.reason !== 'already_posted';
  if (roomFailed || 'reason' in services) {
    const failure = ('reason' in services ? services : room) as { reason: string };
    const status = failure.reason === 'no_reservation' ? 404 : 409;
    return NextResponse.json({ error: failure.reason, detail: failure }, { status });
  }

  const posted = ('posted' in room ? room.posted : 0) + services.posted;
  return NextResponse.json({
    posted,
    gross: ('gross' in room ? room.gross : 0) + services.gross,
    room: 'reason' in room ? { skipped: room.reason } : room,
    services: { posted: services.posted, gross: services.gross },
  }, { status: posted > 0 ? 201 : 200 });
});

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Failed';
}

function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
