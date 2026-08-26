import { NextResponse } from 'next/server';
import { withOwner, type Actor } from '@core/auth/session';
import { hasFeature, type FeatureKey } from '@core/features';
import { secretsConfigured } from '@core/security/secrets';
import {
  INTEGRATION_FEATURE,
  INTEGRATION_FIELDS,
  integrationStatus,
  saveIntegrationCredentials,
  type IntegrationChannel,
  type IntegrationStatus,
} from '@core/integration-credentials';
import { isPaymentChannel, PAYMENT_PROVIDERS, anyGatewayImplemented } from '@core/payments';

/**
 * GET/PUT /api/settings/integration-credentials — whose integration key.
 *
 * Owner-only, like the feature switches next to it: these are the keys that
 * bill the organization and reach its guests. GET never returns a secret —
 * only whether one is set and its last four characters, because anyone who can
 * open the screen can read what it renders.
 */

// Payment gateways share this storage but not this screen: they have their own
// page, where the choice between providers is the point. Listing them in both
// places would give an owner two places to paste the same key and no way to
// tell which one the product reads.
const CHANNELS = (Object.keys(INTEGRATION_FIELDS) as IntegrationChannel[])
  .filter((c) => !isPaymentChannel(c));

export const getIntegrationCredentials = withOwner(async (_req, _ctx, actor: Actor) => {
  // Only integrations this organization actually has. The switch is looked up
  // in INTEGRATION_FEATURE, not guessed from the channel name — guessing is
  // what kept the TSE key off this screen entirely.
  const status: IntegrationStatus[] = [];
  for (const c of CHANNELS) {
    const feature = INTEGRATION_FEATURE[c];
    if (feature && !(await hasFeature(actor.organizationId, feature as FeatureKey))) continue;
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
  const requiredFeature = INTEGRATION_FEATURE[channel];
  if (requiredFeature && !await hasFeature(actor.organizationId, requiredFeature as FeatureKey)) {
    return NextResponse.json({ error: 'Спочатку увімкніть цю інтеграцію' }, { status: 409 });
  }
  // Secrets are stored encrypted or not at all. Without a key the save would
  // have to write plaintext, and a screen that says «Збережено» over a
  // plaintext API key is worse than a screen that refuses — the operator can
  // fix a refusal, and will never look for the other.
  if (!secretsConfigured()) {
    return NextResponse.json(
      { error: 'APP_SECRET_KEY не налаштовано на сервері — ключ інтеграції нема куди зашифрувати' },
      { status: 503 },
    );
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

/**
 * GET /api/settings/payments — which gateway this hotel has chosen.
 *
 * A separate endpoint from the one above even though it reads the same table,
 * because it answers a different question. That one asks «which integrations
 * does this organization have»; this one asks «can a guest pay this hotel
 * online, and if not, what is missing».
 *
 * The answer today is always no, and the field that says so is `live`, per
 * provider, from the registry. Keys saved here are stored and encrypted and do
 * nothing else — the code that would call Stripe is not written. A screen that
 * turned «keys saved» into «payments work» would be the same lie this whole
 * change removes, told one layer down.
 */
export const getPaymentSettings = withOwner(async (_req, _ctx, actor: Actor) => {
  const enabled = await hasFeature(actor.organizationId, 'online_payments' as FeatureKey);
  const providers = [];
  for (const provider of PAYMENT_PROVIDERS) {
    const status = await integrationStatus(provider.id as IntegrationChannel, actor.organizationId);
    providers.push({
      ...provider,
      fields: INTEGRATION_FIELDS[provider.id],
      values: status.values,
      configured: status.configured,
    });
  }
  return NextResponse.json({
    enabled,
    // True only when some gateway in the product could ever charge a card.
    // The screen reads this instead of assuming, so the day one ships the
    // wording changes by itself rather than by somebody remembering.
    anyLive: anyGatewayImplemented(),
    secretsConfigured: secretsConfigured(),
    providers,
  });
});
