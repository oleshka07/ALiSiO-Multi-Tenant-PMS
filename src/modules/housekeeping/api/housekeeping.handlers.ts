/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { PropertyNotFound } from '@core/auth/tenant-context';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { requestPropertyScope } from '@core/auth/property-scope';
import {
  housekeepingBoard, cleaningHistory, setCleaningStatus, CLEANING_STATUSES,
} from '@properties';

/**
 * Housekeeping — борд номерів та історія прибирання (Блок 4 §2.2).
 *
 * Джерело форми — Hoteliera: «Housekeeping Board · Cleaning History», блок
 * «All rooms · Dirty rooms · Recent Cleaning Activity» на дашборді. Ядро,
 * без ключа модуля: готель без прибирання не існує.
 *
 * Модуль не пише SQL до `units` і `unit_cleaning_log` — обидві таблиці
 * належать обʼєкту, тож і стан, і журнал ідуть через фасад `@properties`.
 * Тут — лише варта, розбір запиту і відповідь.
 *
 * Право — `manage_housekeeping`: покоївка каже «чисто», не редагуючи
 * номерний фонд (`manage_properties` для цього завеликий).
 */
type IdParams = { params: Promise<{ id: string }> };

/**
 * Область обʼєкта з адреси — тепер ТИПОМ (INC-029).
 *
 * Було `string | null`, де `null` мовчки означав «уся організація». Тепер
 * `requestPropertyScope` дає `{ kind: 'all' }` словом, памʼятає вибір
 * оператора з куки, коли параметра немає, і віддає 404 на чужий обʼєкт —
 * тим самим порядком, що провайдер у шапці.
 */

export const getHousekeepingBoard = withPermission('manage_housekeeping', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const scope = await requestPropertyScope(request, actor.organizationId);
    return NextResponse.json(await housekeepingBoard(actor.organizationId, scope));
  } catch (e) {
    if (e instanceof PropertyNotFound) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return serverError('modules/housekeeping/api getHousekeepingBoard', e, 'Failed to load board');
  }
});

export const getCleaningHistory = withPermission('manage_housekeeping', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const scope = await requestPropertyScope(request, actor.organizationId);
    const q = new URL(request.url).searchParams;
    const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const rows = await cleaningHistory(actor.organizationId, {
      scope,
      unitId: q.get('unit_id') || null,
      changedBy: q.get('changed_by') || null,
      from: day(q.get('from')),
      to: day(q.get('to')),
      limit: Number(q.get('limit')) || 200,
    });
    return NextResponse.json({ rows });
  } catch (e) {
    if (e instanceof PropertyNotFound) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return serverError('modules/housekeeping/api getCleaningHistory', e, 'Failed to load history');
  }
});

/** PATCH /api/housekeeping/units/[id] { status, note? } — зміна стану в один клік. */
export const setUnitCleaningStatus = withPermission('manage_housekeeping', async (request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as any;
    const to = String(body.status || '');
    if (!(CLEANING_STATUSES as readonly string[]).includes(to)) {
      return NextResponse.json({ error: 'status must be one of clean, dirty, in_progress' }, { status: 400 });
    }
    let change: Awaited<ReturnType<typeof setCleaningStatus>> = null;
    await getSql().tx(async (t) => {
      change = await setCleaningStatus(t, {
        organizationId: actor.organizationId, unitId: id, to: to as 'clean' | 'dirty' | 'in_progress',
        changedBy: actor.user.id, source: 'manual', note: body.note ? String(body.note).slice(0, 500) : null,
      });
    });
    // Чужий або неіснуючий номер — 404, не 403 (інваріант 5).
    if (!change) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(change);
  } catch (e) {
    return serverError('modules/housekeeping/api setUnitCleaningStatus', e, 'Failed to change cleaning status');
  }
});
