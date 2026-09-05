/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';
import { companyStays } from '@bookings/kernel';
import * as repo from '../data/companies.repo';
import { normalizeCompany, InvalidCompany } from '../domain/company';

/**
 * Компанії-платники (Блок 4 §2.3). Джерело форми — Hoteliera «Companies»:
 * пошук за назвою/ID, фільтри «є контакти · є банк · є гості · без архівних»,
 * сортування за назвою/датою, картка з лічильником гостей.
 *
 * Права — як у гостей: читає кожен, хто увійшов; пише `manage_guests`.
 * Компанія — це той самий довідник контрагентів, що й гість, лише юрособа.
 *
 * Лічильники броней/гостей — з `@bookings` (`companyStays`): цей модуль до
 * `reservations` SQL-ом не ходить.
 */
type IdParams = { params: Promise<{ id: string }> };

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

function refuse(e: unknown): NextResponse | null {
  if (e instanceof InvalidCompany) return NextResponse.json({ error: e.reason }, { status: 400 });
  if (e instanceof repo.DuplicateBusinessId) return NextResponse.json({ error: 'duplicate_business_id' }, { status: 409 });
  return null;
}

export const listCompanies = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const q = new URL(request.url).searchParams;
    const flag = (k: string) => q.get(k) === '1' || q.get(k) === 'true';
    const rows = await repo.listCompanies(actor.organizationId, {
      search: q.get('search'),
      hasContact: flag('has_contact'),
      hasBank: flag('has_bank'),
      includeArchived: flag('include_archived'),
      sort: q.get('sort') === 'created_at' ? 'created_at' : 'name',
      dir: q.get('dir') === 'desc' ? 'desc' : 'asc',
    });
    const stays = await companyStays(actor.organizationId);
    let out = rows.map((c) => ({ ...c, ...(stays.get(c.id) ?? { reservations: 0, guests: 0, last_check_in: null }) }));
    if (flag('has_guests')) out = out.filter((c) => c.guests > 0);
    return NextResponse.json({ rows: out });
  } catch (e) {
    return serverError('modules/companies/api listCompanies', e, 'Failed to load companies');
  }
});

export const createCompany = withPermission('manage_guests', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const fields = normalizeCompany(body);
    const id = await repo.createCompany(actor.organizationId, fields as any);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return refuse(e) ?? serverError('modules/companies/api createCompany', e, 'Failed to create company');
  }
});

export const getCompany = withActor(async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const c = await repo.getCompany(actor.organizationId, id);
    if (!c) return NOT_FOUND();
    const stays = (await companyStays(actor.organizationId)).get(id) ?? { reservations: 0, guests: 0, last_check_in: null };
    return NextResponse.json({ ...c, ...stays });
  } catch (e) {
    return serverError('modules/companies/api getCompany', e, 'Failed to load company');
  }
});

/** PATCH: поля довідника і/або `archived: true|false`. Чужа — 404. */
export const updateCompany = withPermission('manage_guests', async (request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const patch = normalizeCompany(body, true);
    const ok = await repo.updateCompany(actor.organizationId, id, patch);
    if (!ok) return NOT_FOUND();
    if (typeof body.archived === 'boolean') {
      await repo.setCompanyArchived(actor.organizationId, id, body.archived);
    }
    return NextResponse.json(await repo.getCompany(actor.organizationId, id));
  } catch (e) {
    return refuse(e) ?? serverError('modules/companies/api updateCompany', e, 'Failed to update company');
  }
});

/** DELETE: лише компанія без броней; з бронями — 409, її архівують. */
export const deleteCompany = withPermission('manage_guests', async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const c = await repo.getCompany(actor.organizationId, id);
    if (!c) return NOT_FOUND();
    const stays = (await companyStays(actor.organizationId)).get(id);
    if (stays && stays.reservations > 0) {
      return NextResponse.json({ error: 'company_in_use', reservations: stays.reservations }, { status: 409 });
    }
    await repo.deleteCompany(actor.organizationId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError('modules/companies/api deleteCompany', e, 'Failed to delete company');
  }
});
