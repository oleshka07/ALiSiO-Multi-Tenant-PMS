/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { requireOrganizationId } from '@core/auth/tenant-context';

const getOrgId = requireOrganizationId;

function isIsoDate(value: any): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

const ISO_CURRENCY = /^[A-Z]{3}$/;

export async function listExchangeRates(_request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = getOrgId(getDb());
    const rates = await sql.rows<any>(`
      SELECT * FROM finance_exchange_rates
      WHERE organization_id = ?
      ORDER BY effective_from DESC, from_currency, to_currency
    `, [orgId]);

    const latest = await sql.rows<any>(`
      SELECT from_currency, to_currency, rate, effective_from
      FROM finance_exchange_rates fr
      WHERE organization_id = ?
        AND effective_from = (
          SELECT MAX(effective_from) FROM finance_exchange_rates
          WHERE organization_id = fr.organization_id
            AND from_currency = fr.from_currency
            AND to_currency = fr.to_currency
            AND effective_from <= date('now')
        )
      ORDER BY from_currency, to_currency
    `, [orgId]);

    return NextResponse.json({ rates, latest });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function upsertExchangeRate(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = await request.json();
    const { id, from_currency, to_currency, rate, effective_from } = body;

    const fromCur = (from_currency || '').toString().trim().toUpperCase();
    const toCur = (to_currency || '').toString().trim().toUpperCase();
    if (!ISO_CURRENCY.test(fromCur) || !ISO_CURRENCY.test(toCur)) {
      return NextResponse.json({ error: 'from_currency and to_currency must be 3-letter ISO codes' }, { status: 400 });
    }
    if (fromCur === toCur) {
      return NextResponse.json({ error: 'from_currency and to_currency must differ' }, { status: 400 });
    }
    const numericRate = Number(rate);
    if (!isFinite(numericRate) || numericRate <= 0) {
      return NextResponse.json({ error: 'rate must be a positive number' }, { status: 400 });
    }
    if (!isIsoDate(effective_from)) {
      return NextResponse.json({ error: 'effective_from must be YYYY-MM-DD' }, { status: 400 });
    }

    const orgId = getOrgId(getDb());

    if (id) {
      const existing = await sql.row<any>("SELECT * FROM finance_exchange_rates WHERE id = ? AND organization_id = ?", [id, orgId]);
      if (!existing) return NextResponse.json({ error: 'Rate not found' }, { status: 404 });
      await sql.run(`
        UPDATE finance_exchange_rates
        SET from_currency = ?, to_currency = ?, rate = ?, effective_from = ?
        WHERE id = ?
      `, [fromCur, toCur, numericRate, effective_from, id]);
      const updated = await sql.row<any>("SELECT * FROM finance_exchange_rates WHERE id = ?", [id]);
      return NextResponse.json(updated);
    }

    const newId = `fx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await sql.run(`
        INSERT INTO finance_exchange_rates
          (id, organization_id, from_currency, to_currency, rate, effective_from)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [newId, orgId, fromCur, toCur, numericRate, effective_from]);
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        await sql.run(`
          UPDATE finance_exchange_rates
          SET rate = ?
          WHERE organization_id = ? AND from_currency = ? AND to_currency = ? AND effective_from = ?
        `, [numericRate, orgId, fromCur, toCur, effective_from]);
        const upd = await sql.row<any>(`
          SELECT * FROM finance_exchange_rates
          WHERE organization_id = ? AND from_currency = ? AND to_currency = ? AND effective_from = ?
        `, [orgId, fromCur, toCur, effective_from]);
        return NextResponse.json(upd, { status: 200 });
      }
      throw e;
    }

    const created = await sql.row<any>("SELECT * FROM finance_exchange_rates WHERE id = ?", [newId]);
    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function deleteExchangeRate(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = getOrgId(getDb());
    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const existing = await sql.row<any>("SELECT * FROM finance_exchange_rates WHERE id = ? AND organization_id = ?", [id, orgId]);
    if (!existing) return NextResponse.json({ error: 'Rate not found' }, { status: 404 });
    await sql.run("DELETE FROM finance_exchange_rates WHERE id = ?", [id]);
    return NextResponse.json({ ok: true, deleted_id: id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/finance/exchange-rates/current?from=EUR&to=CZK&date=2026-05-20
 * Returns the effective rate for a currency pair on a specific date.
 * Used by OperationModal to preview the conversion before saving.
 */
export async function getCurrentRate(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();
    const orgId = getOrgId(getDb());
    const { searchParams } = new URL(request.url);
    const fromCur = (searchParams.get('from') || '').toUpperCase();
    const toCur = (searchParams.get('to') || 'CZK').toUpperCase();
    const date = searchParams.get('date') || new Date().toISOString().substring(0, 10);

    if (!fromCur || fromCur === toCur) {
      return NextResponse.json({ rate: 1, effective_from: date, is_fallback: false });
    }

    // 1. Exact or earlier rate for the requested date
    let row = await sql.row<any>(`
      SELECT rate, effective_from FROM finance_exchange_rates
      WHERE organization_id = ? AND from_currency = ? AND to_currency = ? AND effective_from <= ?
      ORDER BY effective_from DESC LIMIT 1
    `, [orgId, fromCur, toCur, date]) as { rate: number; effective_from: string } | undefined;

    if (row) {
      return NextResponse.json({ rate: row.rate, effective_from: row.effective_from, is_fallback: false });
    }

    // 2. Fallback: latest rate of any date
    row = await sql.row<any>(`
      SELECT rate, effective_from FROM finance_exchange_rates
      WHERE organization_id = ? AND from_currency = ? AND to_currency = ?
      ORDER BY effective_from DESC LIMIT 1
    `, [orgId, fromCur, toCur]) as { rate: number; effective_from: string } | undefined;

    if (row) {
      return NextResponse.json({ rate: row.rate, effective_from: row.effective_from, is_fallback: true });
    }

    return NextResponse.json({ rate: null, effective_from: null, is_fallback: false, error: `No ${fromCur}→${toCur} rate configured` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
