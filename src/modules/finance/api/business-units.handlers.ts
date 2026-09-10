/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { propertyOrSharedFilter, requirePropertyScope, requestedPropertyParam } from '@core/property-scope';

/**
 * The business units of THIS hotel.
 *
 * `WHERE is_active` and nothing else: the list returned every business unit on
 * the server. It feeds the «Object» picker on the tasks screen, so one hotel's
 * staff were offered another hotel's departments by name — and picking one
 * then failed a foreign key, which is the other half of this story (D1).
 */
export async function listBusinessUnits(request: Request): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = await requireOrganizationId();
    // І ЦЬОГО ОБʼЄКТА, плюс спільні (INC-038, Д54): два будинки під одним
    // рахунком ведуть дві бухгалтерії, тож підрозділ одного не має стояти в
    // списку іншого. `propertyOrSharedFilter`, як Д51: підрозділ рахунку
    // (дирекція, спільна котельня) лишається видимим з обох.
    const axis = propertyOrSharedFilter(
      await requirePropertyScope(requestedPropertyParam(request.url)), '');
    const units = await sql.rows<any>(
      `SELECT * FROM business_units
        WHERE organization_id = ? AND ${axis.sql} AND is_active = TRUE ORDER BY sort_order ASC`,
      [orgId, ...axis.params]);
    return NextResponse.json(units);
  } catch (error: any) {
    return serverError('modules/finance/api/business-units listBusinessUnits', error);
  }
}
