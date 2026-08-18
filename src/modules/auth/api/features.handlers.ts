import { NextResponse } from 'next/server';
import { withOwner, type Actor } from '@core/auth/session';
import { FEATURES, listFeatures, setFeature, type FeatureKey } from '@core/features';

/**
 * GET/PUT /api/settings/features — which integrations this organization has.
 *
 * Owner-only in both directions: the switch decides what the whole
 * organization sees (sidebar) and may call (routes), from the same table.
 */

export const getOrgFeatures = withOwner(async (_req, _ctx, actor: Actor) => {
  return NextResponse.json({
    catalog: FEATURES,
    features: await listFeatures(actor.organizationId),
  });
});

export const updateOrgFeature = withOwner(async (request: Request, _ctx, actor: Actor) => {
  const { feature, enabled } = await request.json().catch(() => ({}));
  if (!(feature in FEATURES) || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'Потрібно: feature (відомий ключ) і enabled (boolean)' }, { status: 400 });
  }
  // No getDb() here, and that is a decision, not tidiness. This handler used
  // to open the legacy SQLite handle it never read, so switching a feature on
  // depended on a database the feature does not live in — and on a Postgres
  // server whose side-SQLite failed to boot, the toggle answered 500. The
  // seam below is the only engine this write needs.
  await setFeature(actor.organizationId, feature as FeatureKey, enabled);
  return NextResponse.json({ features: await listFeatures(actor.organizationId) });
});
