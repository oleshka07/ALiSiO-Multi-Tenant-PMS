/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql, type Sql } from './db/async.ts';

/**
 * The feature registry: which integrations this organization actually bought.
 *
 * One question, asked from both sides. The sidebar hides the menu item and the
 * route refuses the request off the SAME row in organization_features, so a
 * feature an organization does not have is invisible to it, not merely
 * de-linked. Absence of a row means OFF — a new organization starts with
 * nothing enabled.
 */

export const FEATURES = {
  hostex: 'Channel manager Hostex',
  pricelabs: 'Динамічні ціни PriceLabs',
  telegram: 'Telegram-міст (задачі, реєстрація)',
  widget: 'Віджет бронювання і сайти',
  // Німецька фіскалізація (KassenSichV/TSE). Поки вимкнена, DE-готель НЕ
  // може записати готівку чи карту-на-рецепції — інакше PMS тихо стала б
  // незареєстрованою касою (docs/TSE-KASSENSICHV.md §6.4, блок A).
  fiscal_de: 'Фіскалізація Німеччини (TSE)',
} as const;

export type FeatureKey = keyof typeof FEATURES;

export async function hasFeature(organizationId: string, feature: FeatureKey): Promise<boolean> {
  const sql = getSql();
  const row = await sql.row<any>('SELECT enabled FROM organization_features WHERE organization_id = ? AND feature = ?', [organizationId, feature]) as { enabled: number } | undefined;
  return row ? row.enabled === 1 : false;
}

/** Every feature with its state — for the settings screen and /api/auth/me. */
export async function listFeatures(organizationId: string): Promise<Record<FeatureKey, boolean>> {
  const out = {} as Record<FeatureKey, boolean>;
  for (const key of Object.keys(FEATURES) as FeatureKey[]) {
    out[key] = await hasFeature(organizationId, key);
  }
  return out;
}

/** `handle` is for a caller already inside a transaction — see provisioning. */
export async function setFeature(organizationId: string, feature: FeatureKey, enabled: boolean, handle?: Sql): Promise<void> {
  const sql = handle ?? getSql();
  await sql.run(`
    INSERT INTO organization_features (organization_id, feature, enabled, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(organization_id, feature)
    DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
  `, [organizationId, feature, enabled ? 1 : 0]);
}

/**
 * The refusal a handler returns when the organization lacks the feature.
 *
 * A plain Response, not NextResponse: importing 'next/server' here would make
 * the whole registry unloadable outside the bundler, and provisioning needs to
 * write feature rows from a plain node script. Next accepts either.
 */
export function featureDisabled(feature: FeatureKey, headers?: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: `Feature "${feature}" is not enabled for this organization` }),
    { status: 403, headers: { 'Content-Type': 'application/json', ...(headers || {}) } },
  );
}
