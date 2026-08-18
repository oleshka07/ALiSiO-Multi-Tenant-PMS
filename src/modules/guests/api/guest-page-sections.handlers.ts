/**
 * GET/PUT /api/settings/guest-page-sections — the guest page's assembly.
 *
 * GET answers with every registry section resolved for one property —
 * enabled, order, locked — so the settings screen renders switches without
 * knowing the merge rules. PUT takes a list of differences and refuses
 * unknown keys loudly: a typo that quietly landed in the table would read
 * as "configured, does nothing" forever.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId, propertyErrorStatus } from '@core/auth/tenant-context';
import { getGuestPageSections, saveGuestPageSection } from '../data/guest-portal.repo';
import { getSql } from '@core/db/async';

async function resolveProperty(actor: Actor, raw: string | null) {
  const propertyId = await requirePropertyId(raw ?? undefined);
  const row = await getSql().row<any>(
    'SELECT id, country FROM properties WHERE id = ? AND organization_id = ?',
    [propertyId, actor.organizationId]);
  if (!row) throw new Error('Property not found');
  return row as { id: string; country: string | null };
}

export const listGuestPageSections = withPermission('manage_properties', async (
  request: NextRequest, _ctx: unknown, actor: Actor,
) => {
  try {
    const property = await resolveProperty(actor, new URL(request.url).searchParams.get('property_id'));
    return NextResponse.json({
      propertyId: property.id,
      sections: await getGuestPageSections(property.id, property.country),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed' },
      { status: propertyErrorStatus(e) });
  }
});

export const updateGuestPageSections = withPermission('manage_properties', async (
  request: NextRequest, _ctx: unknown, actor: Actor,
) => {
  try {
    const body = await request.json().catch(() => ({})) as any;
    const property = await resolveProperty(actor, body.property_id ?? null);
    const changes = Array.isArray(body.sections) ? body.sections : [];
    if (!changes.length) {
      return NextResponse.json({ error: 'sections is required' }, { status: 400 });
    }
    for (const c of changes) {
      const ok = await saveGuestPageSection(actor.organizationId, property.id, {
        section: String(c.section ?? ''),
        enabled: typeof c.enabled === 'boolean' ? c.enabled : undefined,
        sortOrder: c.sort_order === undefined ? undefined : (c.sort_order == null ? null : Number(c.sort_order)),
        config: c.config === undefined ? undefined : c.config,
      });
      if (!ok) {
        return NextResponse.json(
          { error: `Unknown section: ${c.section}` }, { status: 400 });
      }
    }
    // The final state, not an ack: the screen re-renders from this, and a
    // locked section that ignored its toggle is visible immediately.
    return NextResponse.json({
      propertyId: property.id,
      sections: await getGuestPageSections(property.id, property.country),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed' },
      { status: propertyErrorStatus(e) });
  }
});
