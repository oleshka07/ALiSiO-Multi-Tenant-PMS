/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';

export async function listBusinessUnits(): Promise<NextResponse> {
  try {
    const sql = getSql();
    const units = await sql.rows<any>(`SELECT * FROM business_units WHERE is_active = TRUE ORDER BY sort_order ASC`);
    return NextResponse.json(units);
  } catch (error: any) {
    return serverError('modules/finance/api/business-units listBusinessUnits', error);
  }
}
