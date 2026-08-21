import { NextResponse } from 'next/server';
import { withOwner, type Actor } from '@core/auth/session';
import { hasFeature, type FeatureKey } from '@core/features';
import {
  INTEGRATION_FIELDS,
  integrationStatus,
  saveIntegrationCredentials,
  type IntegrationChannel,
  type IntegrationStatus,
} from '@core/integration-credentials';

/**
 * GET/PUT /api/settings/integration-credentials — whose Hostex account, whose
 * PriceLabs key.
 *
 * Owner-only, like the feature switches next to it: these are the keys that
 * bill the organization and reach its guests. GET never returns a secret —
 * only whether one is set and its last four characters, because anyone who can
 * open the screen can read what it renders.
 */

const CHANNELS = Object.keys(INTEGRATION_FIELDS) as IntegrationChannel[];

export const getIntegrationCredentials = withOwner(async (_req, _ctx, actor: Actor) => {
  // Only integrations this organization actually has. booking_com has no
  // feature key of its own — it rides on the channel manager.
  const status: IntegrationStatus[] = [];
  for (const c of CHANNELS) {
    if (c !== 'booking_com' && !(await hasFeature(actor.organizationId, c as FeatureKey))) continue;
    status.push(await integrationStatus(c, actor.organizationId));
  }
  return NextResponse.json({ fields: INTEGRATION_FIELDS, status });
});

export const updateIntegrationCredentials = withOwner(async (request: Request, _ctx, actor: Actor) => {
  const body = await request.json().catch(() => ({}));
  const { channel, values } = body as { channel?: string; values?: Record<string, string> };

  if (!channel || !(channel in INTEGRATION_FIELDS)) {
    return NextResponse.json({ error: 'Невідома інтеграція' }, { status: 400 });
  }
  if (!values || typeof values !== 'object') {
    return NextResponse.json({ error: 'Потрібно: values' }, { status: 400 });
  }
  // Saving a key for an integration the organization has not enabled would
  // store a secret nothing can use — and hide the real problem, which is that
  // the feature is off.
  if (channel !== 'booking_com' && !await hasFeature(actor.organizationId, channel as FeatureKey)) {
    return NextResponse.json({ error: 'Спочатку увімкніть цю інтеграцію' }, { status: 409 });
  }

  const clean: Record<string, string> = {};
  for (const { field } of INTEGRATION_FIELDS[channel]) {
    const v = values[field];
    if (typeof v === 'string') clean[field] = v.trim();
  }
  if (!Object.keys(clean).length) {
    return NextResponse.json({ error: 'Жодного відомого поля' }, { status: 400 });
  }

  await saveIntegrationCredentials(actor.organizationId, channel as IntegrationChannel, clean);
  return NextResponse.json({ status: await integrationStatus(channel as IntegrationChannel, actor.organizationId) });
});
