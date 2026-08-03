/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { withActor, type Actor } from '@core/auth/session';
import { hasFeature, featureDisabled } from '@core/features';
import { syncReservations, syncSingleReservation, getSyncStatus, seedPropertyMap } from '../data/hostex-sync';
import { getReservations, getProperties } from '../domain/hostex-client';

// ─── /api/hostex/sync ─────────────────────────────────────────────────────────
// hostexSync and hostexBulkSync stay bare: their routes are cron-secret
// endpoints, there is no session to read a feature from.

export async function hostexSync(): Promise<NextResponse> {
  try {
    const seedResult = await seedPropertyMap();
    const result = await syncReservations();
    return NextResponse.json({ success: true, ...result, unmappedProperties: seedResult?.unmapped || [] });
  } catch (e: any) {
    return hostexError('request', e);
  }
}

export const hostexSyncStatus = withActor(async (_req, _ctx, actor: Actor) => {
  if (!hasFeature(getDb(), actor.organizationId, 'hostex')) return featureDisabled('hostex');
  try {
    return NextResponse.json(getSyncStatus());
  } catch (e: any) {
    return hostexError('request', e);
  }
});

// ─── /api/hostex/reservations ─────────────────────────────────────────────────

export const hostexReservations = withActor(async (request, _ctx, actor: Actor) => {
  if (!hasFeature(getDb(), actor.organizationId, 'hostex')) return featureDisabled('hostex');
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const per_page = parseInt(url.searchParams.get('per_page') || '20');
    const status = url.searchParams.get('status') || undefined;
    const property_id = url.searchParams.get('property_id') ? parseInt(url.searchParams.get('property_id')!) : undefined;
    const result = await getReservations({ page, per_page, status, property_id });
    return NextResponse.json(result);
  } catch (e: any) {
    return hostexError('request', e);
  }
});

// ─── /api/hostex/properties ───────────────────────────────────────────────────

/**
 * An unconfigured integration is 503, not 500 — the server is fine, nobody has
 * connected Hostex yet. Everything else is logged and answered generically.
 */
function hostexError(where: string, e: any): NextResponse {
  const status = typeof e?.status === 'number' && e.status >= 400 ? e.status : 500;
  console.error(`[Hostex] ${where}:`, e?.message || e);
  return NextResponse.json(
    { error: status === 503 ? e.message : 'Hostex request failed' },
    { status },
  );
}

export const hostexProperties = withActor(async (_req, _ctx, actor: Actor) => {
  if (!hasFeature(getDb(), actor.organizationId, 'hostex')) return featureDisabled('hostex');
  try {
    const properties = await getProperties();
    const db = getDb();
    let mappings: any[] = [];
    try { mappings = db.prepare('SELECT * FROM hostex_property_map').all(); } catch { /* table may not exist yet */ }
    const mappingMap = new Map(mappings.map((m: any) => [m.hostex_property_id, m]));
    const result = properties.map(p => ({ ...p, mapping: mappingMap.get(p.id) || null, is_mapped: mappingMap.has(p.id) }));
    return NextResponse.json({ properties: result });
  } catch (e: any) {
    return hostexError('request', e);
  }
});

// ─── /api/hostex/bulk-sync ────────────────────────────────────────────────────

export async function hostexBulkSync(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const codesParam = searchParams.get('codes');

  try {
    if (codesParam) {
      const codes = codesParam.split(',').map(c => c.trim()).filter(Boolean);
      console.log(`[Bulk Sync] Force-syncing ${codes.length} specific codes:`, codes);

      const results: { code: string; status: string; created: number; updated: number; error?: string }[] = [];
      for (const code of codes) {
        try {
          const r = await syncSingleReservation(code);
          results.push({ code, status: r.errors.length ? 'error' : 'ok', created: r.created, updated: r.updated, error: r.errors[0] });
        } catch (e: any) {
          results.push({ code, status: 'error', created: 0, updated: 0, error: e.message });
        }
        await new Promise(r => setTimeout(r, 200));
      }

      return NextResponse.json({
        mode: 'targeted',
        total: codes.length,
        created: results.reduce((s, r) => s + r.created, 0),
        updated: results.reduce((s, r) => s + r.updated, 0),
        errors: results.filter(r => r.status === 'error').length,
        results,
      });
    }

    console.log('[Bulk Sync] Running full per-property sync...');
    const result = await syncReservations();
    return NextResponse.json({ mode: 'full', synced: result.synced, created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors.length, errorDetails: result.errors, eurCzkRate: result.eurCzkRate });
  } catch (e: any) {
    return hostexError('request', e);
  }
}
