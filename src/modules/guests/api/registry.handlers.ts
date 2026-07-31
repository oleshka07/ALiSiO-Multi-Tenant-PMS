/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import * as registryRepo from '../data/registry.repo';
import { withPermission, notFound, type Actor } from '@core/auth/session';

/**
 * The guest registry — names, dates of birth, nationality, document type and
 * number, address — was reachable without any authentication at all: the route
 * sat behind the '/api/guest-registry' public prefix, whose comment claimed
 * "session or Bearer token auth", and no handler checked either. The CSV
 * export was open too, so the whole registry of every hotel on the server
 * could be downloaded by anyone who knew the path.
 *
 * It needs a session and manage_guests, and everything is scoped to the
 * caller's organization.
 */

// ─── GET /api/guest-registry ─────────────────────────────────────────────────

export const getRegistry = withPermission('manage_guests', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const month = searchParams.get('month') || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const foreignersOnly = searchParams.get('foreignersOnly') === 'true';
    const unregisteredOnly = searchParams.get('unregisteredOnly') === 'true';
    const search = searchParams.get('search') || undefined;
    const propertyId = searchParams.get('propertyId') || undefined;

    const entries = registryRepo.getRegistryEntries(actor.organizationId, { month, foreignersOnly, unregisteredOnly, search, propertyId });
    const summary = registryRepo.getRegistrySummary(actor.organizationId, { month, propertyId });

    return NextResponse.json({ entries, summary });
  } catch (error: any) {
    console.error('GET /api/guest-registry error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to fetch registry' }, { status: 500 });
  }
})

// ─── PATCH /api/guest-registry/[id] ──────────────────────────────────────────

export const updateRegistryEntry = withPermission('manage_guests', async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
) => {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action } = body;
    const org = actor.organizationId;

    // false means the entry is not this organization's; 404 rather than 403,
    // so ids cannot be probed.
    let done: boolean;
    switch (action) {
      case 'mark_police':
        done = registryRepo.markPoliceReported(org, id, body.ref || '');
        break;
      case 'unmark_police':
        done = registryRepo.unmarkPoliceReported(org, id);
        break;
      case 'update_fee': {
        const { feeAmount, feeExempt, feeExemptReason } = body;
        done = registryRepo.updateFee(org, id, { feeAmount, feeExempt, feeExemptReason });
        break;
      }
      case 'hide':
        done = registryRepo.hideRegistryEntry(org, id);
        break;
      case 'unhide':
        done = registryRepo.unhideRegistryEntry(org, id);
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    if (!done) return notFound();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('PATCH /api/guest-registry/[id] error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to update registry entry' }, { status: 500 });
  }
})

// ─── GET /api/guest-registry?format=csv ──────────────────────────────────────

export const exportRegistry = withPermission('manage_guests', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const month = searchParams.get('month') || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const foreignersOnly = searchParams.get('foreignersOnly') === 'true';
    const unregisteredOnly = searchParams.get('unregisteredOnly') === 'true';
    const search = searchParams.get('search') || undefined;
    const propertyId = searchParams.get('propertyId') || undefined;

    const entries = registryRepo.getRegistryEntries(actor.organizationId, { month, foreignersOnly, unregisteredOnly, search, propertyId });

    const headers = [
      'Jméno', 'Příjmení', 'Datum narození', 'Státní příslušnost',
      'Typ dokladu', 'Číslo dokladu', 'Adresa', 'Účel pobytu',
      'Check-in', 'Check-out', 'Noci', 'Jednotka',
      'Poplatek', 'Osvobozeno', 'Důvod osvobození',
      'Nahlášeno policii', 'Ref. policie',
    ];

    const escCsv = (val: any): string => {
      if (val == null) return '';
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = entries.map((e: any) => [
      e.first_name, e.last_name, e.date_of_birth, e.nationality,
      e.document_type, e.document_number, e.address, e.purpose_of_stay,
      e.check_in, e.check_out, e.nights, e.unit_name,
      e.fee_amount, e.fee_exempt ? 'Ano' : 'Ne', e.fee_exempt_reason,
      e.police_reported ? 'Ano' : 'Ne', e.police_report_ref,
    ].map(escCsv).join(','));

    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="evidencni-kniha-${month}.csv"`,
      },
    });
  } catch (error: any) {
    console.error('GET /api/guest-registry?format=csv error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to export registry' }, { status: 500 });
  }
})
