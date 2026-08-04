/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';

// ─────────────────────────────────────────────────────────────────
// Finance User Access — API handlers
//
// Manages per-user finance access: which users can see finance,
// which tabs/accounts they can access, period restrictions, etc.
// ─────────────────────────────────────────────────────────────────

export interface FinanceAccessRow {
  user_id: string;
  is_enabled: number;
  period_mode: 'all' | 'month';
  allowed_tabs: string;     // JSON array
  allowed_accounts: string; // JSON array
  can_export: number;
  read_only: number;
  created_at: string;
  updated_at: string;
}

export interface FinanceAccessParsed {
  is_enabled: boolean;
  period_mode: 'all' | 'month';
  allowed_tabs: string[];
  allowed_accounts: string[];
  can_export: boolean;
  read_only: boolean;
}

function parseAccess(row: FinanceAccessRow): FinanceAccessParsed {
  return {
    is_enabled: !!row.is_enabled,
    period_mode: row.period_mode,
    allowed_tabs: safeJsonParse(row.allowed_tabs, ['operations']),
    allowed_accounts: safeJsonParse(row.allowed_accounts, []),
    can_export: !!row.can_export,
    read_only: !!row.read_only,
  };
}

function safeJsonParse(s: string | null, fallback: any): any {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

/**
 * Check if a user has finance access via the finance_user_access table.
 * Used by _guard.ts to authorize non-owner users.
 */
export async function isFinanceUserEnabled(userId: string): Promise<boolean> {
  const sql = getSql();
  const row = await sql.row<any>('SELECT 1 FROM finance_user_access WHERE user_id = ? AND is_enabled = 1', [userId]);
  return !!row;
}

/**
 * Get the full access configuration for a user.
 * Returns null if no access record exists.
 */
export async function getFinanceAccessForUser(userId: string): Promise<FinanceAccessParsed | null> {
  const sql = getSql();
  const row = await sql.row<any>('SELECT * FROM finance_user_access WHERE user_id = ?', [userId]) as FinanceAccessRow | undefined;
  if (!row) return null;
  return parseAccess(row);
}

/**
 * GET /api/finance/access
 * List all non-owner users with their finance access settings.
 * Owner-only.
 */
export async function listFinanceAccess(): Promise<NextResponse> {
  try {
    const sql = getSql();

    const users = await sql.rows<any>(`
      SELECT u.id, u.full_name, u.email, u.role, u.is_active,
             fa.is_enabled, fa.period_mode, fa.allowed_tabs,
             fa.allowed_accounts, fa.can_export, fa.read_only
      FROM app_users u
      LEFT JOIN finance_user_access fa ON fa.user_id = u.id
      WHERE u.role != 'owner'
      ORDER BY u.full_name
    `) as any[];

    const result = users.map((u) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      is_active: !!u.is_active,
      access: u.is_enabled !== null ? {
        is_enabled: !!u.is_enabled,
        period_mode: u.period_mode || 'month',
        allowed_tabs: safeJsonParse(u.allowed_tabs, ['operations']),
        allowed_accounts: safeJsonParse(u.allowed_accounts, []),
        can_export: !!u.can_export,
        read_only: u.read_only !== null ? !!u.read_only : true,
      } : null,
    }));

    return NextResponse.json({ users: result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT /api/finance/access/[id]
 * Create or update finance access for a user.
 * Owner-only.
 */
export async function upsertFinanceAccess(request: NextRequest, context: any): Promise<NextResponse> {
  try {
    const sql = getSql();
    const params = await context.params;
    const userId = params.id;

    if (!userId) {
      return NextResponse.json({ error: 'Missing user id' }, { status: 400 });
    }

    // Verify user exists and is not owner
    const user = await sql.row<any>('SELECT id, role FROM app_users WHERE id = ?', [userId]) as any;
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (user.role === 'owner') {
      return NextResponse.json({ error: 'Cannot modify owner access' }, { status: 400 });
    }

    const body = await request.json();
    const {
      is_enabled = false,
      period_mode = 'month',
      allowed_tabs = ['operations'],
      allowed_accounts = [],
      can_export = false,
      read_only = true,
    } = body;

    // Validate period_mode
    if (!['all', 'month'].includes(period_mode)) {
      return NextResponse.json({ error: 'period_mode must be all or month' }, { status: 400 });
    }

    await sql.run(`
      INSERT INTO finance_user_access (user_id, is_enabled, period_mode, allowed_tabs, allowed_accounts, can_export, read_only, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        is_enabled = excluded.is_enabled,
        period_mode = excluded.period_mode,
        allowed_tabs = excluded.allowed_tabs,
        allowed_accounts = excluded.allowed_accounts,
        can_export = excluded.can_export,
        read_only = excluded.read_only,
        updated_at = CURRENT_TIMESTAMP
    `, [userId,
      is_enabled ? 1 : 0,
      period_mode,
      JSON.stringify(allowed_tabs),
      JSON.stringify(allowed_accounts),
      can_export ? 1 : 0,
      read_only ? 1 : 0]);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/finance/access/[id]
 * Revoke finance access for a user.
 * Owner-only.
 */
export async function deleteFinanceAccess(_request: NextRequest, context: any): Promise<NextResponse> {
  try {
    const sql = getSql();
    const params = await context.params;
    const userId = params.id;

    await sql.run('DELETE FROM finance_user_access WHERE user_id = ?', [userId]);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/finance/access/my
 * Returns the current user's finance access restrictions.
 * Available to any authenticated finance user.
 */
export async function getMyFinanceAccess(request: NextRequest): Promise<NextResponse> {
  try {
    const sql = getSql();

    // Extract user from cookie — we import lazily to avoid circular deps
    const { cookies } = await import('next/headers');
    const store = await cookies();
    const sessionId = store.get('session_id')?.value;
    if (!sessionId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { getSessionUser } = await import('@core/auth');
    const user = getSessionUser(sessionId);
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Owner has no restrictions
    if (user.role === 'owner') {
      return NextResponse.json({
        is_owner: true,
        is_enabled: true,
        period_mode: 'all',
        allowed_tabs: [],  // empty = all
        allowed_accounts: [],  // empty = all
        can_export: true,
        read_only: false,
      });
    }

    const access = await getFinanceAccessForUser(user.id);
    if (!access || !access.is_enabled) {
      return NextResponse.json({ error: 'No finance access' }, { status: 403 });
    }

    return NextResponse.json({
      is_owner: false,
      ...access,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
