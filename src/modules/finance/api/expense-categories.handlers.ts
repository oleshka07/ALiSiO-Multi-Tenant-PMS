/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { serverError } from '@core/http/errors';
import { AXIS_BY_STD_GROUP } from '@core/chart-of-accounts';
import {
  propertyOrSharedFilter, requirePropertyScope, requestedPropertyParam, scopedPropertyId,
} from '@core/property-scope';

/**
 * Вісь обʼєкта в довіднику статей (INC-038, Д54).
 *
 * «не можуть бути одні фінанси на 2 обʼєкти, бо в них різна бухгалтерія» —
 * рішення власника 09.09. Список показує СВОЄ І СПІЛЬНЕ (`propertyOrSharedFilter`,
 * як Д51: стаття рахунку має лишатись видимою з обох будинків), а писач бере
 * обʼєкт з ОБЛАСТІ ЗАПИТУ, не з тіла — тіло приходить від форми, а форма не
 * знає, який будинок обрано в шапці.
 */
const scopeOf = async (request: Request) =>
  await requirePropertyScope(requestedPropertyParam(request.url));

export async function listExpenseCategories(request: Request): Promise<NextResponse> {
  try {
    const sql = getSql();
    const axis = propertyOrSharedFilter(await scopeOf(request), '');
    // The organization is named, not only left to the policy. The guard in
    // index.ts sets the tenant, which is enough on Postgres; SQLite has no
    // policies, and this list is the chart of accounts every expense form
    // offers — one hotel was picking from every hotel's categories, and an
    // operation filed under a foreign category lands in a foreign report.
    const categories = await sql.rows<any>(
      `SELECT * FROM expense_categories
        WHERE organization_id = ? AND ${axis.sql} AND is_active = TRUE ORDER BY sort_order ASC`,
      [await requireOrganizationId(), ...axis.params],
    );
    return NextResponse.json(categories);
  } catch (error: any) {
    return serverError('modules/finance/api/expense-categories listExpenseCategories', error);
  }
}

export async function createExpenseCategory(request: Request): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = await request.json();
    const { name, std_group, pnl_line, alloc_method, icon, color } = body;

    if (!name || !std_group || !pnl_line) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });

    const orgRow = { id: await requireOrganizationId() } as any;
    const id = `ec_${Date.now()}`;
    // Same organization: an unqualified MAX() takes the highest sort_order on
    // the whole server, so a new category of a small hotel is created at
    // position 200 because somebody else has 199 of them.
    const propertyId = scopedPropertyId(await scopeOf(request));
    // Порядок рахується в тому ж кошику, у якому стаття зʼявиться: своє плюс
    // спільне. Інакше нова стаття будинку сідала б за статтями сусіда.
    const orderAxis = propertyOrSharedFilter(await scopeOf(request), '');
    const maxOrder = await sql.row<any>(
      `SELECT MAX(sort_order) as mx FROM expense_categories
        WHERE organization_id = ? AND ${orderAxis.sql}`, [orgRow.id, ...orderAxis.params]) as any;

    // Осі — з `core/chart-of-accounts.ts`, бо саме він СІЄ (Р13.5, Д37).
    // Тут стояла власна копія мапи, і в ній `Financing → expense` проти
    // засіву `investors → income`: готель, який заводив власну статтю
    // фінансування, діставав статтю, якої немає у формі надходження.
    const axis = AXIS_BY_STD_GROUP[std_group] || { opType: 'other', classifier: 'other' };

    await sql.run(`
      INSERT INTO expense_categories (id, organization_id, property_id, name, std_group, pnl_line, alloc_method, icon, color, sort_order, op_type, classifier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, orgRow.id, propertyId, name, std_group, pnl_line, alloc_method || 'DIRECT', icon || '📋', color || '#6b7280', (maxOrder?.mx || 0) + 1, axis.opType, axis.classifier]);

    // Читання щойно вставленого рядка ЗА ВЛАСНИМ id, і орендар названий поруч:
    // осі обʼєкта тут нема чого називати — рядок щойно створено в цій області,
    // і питання «якого він будинку» вже відповіла вставка вище.
    return NextResponse.json(await sql.row<any>(
      "SELECT * FROM expense_categories WHERE id = ? AND organization_id = ?", [id, orgRow.id]), { status: 201 });
  } catch (error: any) {
    return serverError('modules/finance/api/expense-categories createExpenseCategory', error);
  }
}
