/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@core/db';
import { hashPassword } from '@core/auth';
import { withPermission, notFound, type Actor } from '@core/auth/session';

/**
 * Staff accounts.
 *
 * These handlers looked users up by the id in the URL and nothing else, so an
 * owner of one hotel could read, rename, re-role, deactivate or delete another
 * hotel's staff — including its owner. The permission check was there; the
 * ownership check was not. Every lookup is now constrained by the caller's
 * organization, and a user from another one answers 404 rather than 403, so
 * ids cannot be probed.
 */

/** The user, if this organization owns it. */
function ownedUser(db: any, organizationId: string, id: string): any {
  return db.prepare('SELECT * FROM app_users WHERE id = ? AND organization_id = ?')
    .get(id, organizationId);
}

export const getUser = withPermission('manage_users', async (
  _request,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
) => {
  try {
    const { id } = await params;
    const db = getDb();
    const user = db.prepare(`
      SELECT id, organization_id, email, full_name, phone, telegram_chat_id, role, is_active,
             default_cash_account_id, (payment_pin_hash IS NOT NULL) AS has_payment_pin,
             last_login, created_at, updated_at
      FROM app_users WHERE id = ? AND organization_id = ?
    `).get(id, actor.organizationId);

    if (!user) return notFound();

    const overrides = db.prepare(
      'SELECT permission, granted FROM user_permissions WHERE user_id = ?'
    ).all(id);

    return NextResponse.json({ user, overrides });
  } catch (error) {
    console.error('User GET error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
});

export const updateUser = withPermission('manage_users', async (
  request,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
) => {
  try {
    const { id } = await params;
    const db = getDb();
    const existing = ownedUser(db, actor.organizationId, id);
    if (!existing) return notFound();

    const body = await request.json();

    if (body.password) {
      const passwordHash = hashPassword(body.password);
      db.prepare("UPDATE app_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(passwordHash, id);
    }

    // The PIN a receptionist types to confirm a cash payment from the booking
    // widget. Stored hashed like a password, because it is one — it authorises
    // marking money as received. Sending null clears it.
    if (body.payment_pin !== undefined) {
      if (body.payment_pin === null || body.payment_pin === '') {
        db.prepare("UPDATE app_users SET payment_pin_hash = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
      } else {
        const pin = String(body.payment_pin).trim();
        if (!/^\d{4,8}$/.test(pin)) {
          return NextResponse.json({ error: 'PIN має бути 4–8 цифр' }, { status: 400 });
        }
        db.prepare("UPDATE app_users SET payment_pin_hash = ?, updated_at = datetime('now') WHERE id = ?")
          .run(bcrypt.hashSync(pin, 10), id);
      }
    }

    if (body.full_name || body.email || body.phone !== undefined || body.telegram_chat_id !== undefined || body.role || body.is_active !== undefined || body.default_cash_account_id !== undefined) {
      const fullName = body.full_name || existing.full_name;
      const email = body.email || existing.email;
      const phone = body.phone !== undefined ? body.phone : existing.phone;
      const telegramChatId = body.telegram_chat_id !== undefined ? (body.telegram_chat_id || null) : existing.telegram_chat_id;
      const role = body.role || existing.role;
      const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;
      const cashAcct = body.default_cash_account_id !== undefined ? (body.default_cash_account_id || null) : existing.default_cash_account_id;

      if (existing.role === 'owner' && role !== 'owner' && actor.user.role !== 'owner') {
        return NextResponse.json({ error: 'Не можна змінити роль Власника' }, { status: 403 });
      }

      // The cash account has to be this organization's, or the payments a
      // receptionist confirms would land in another hotel's books.
      if (cashAcct) {
        const owned = db.prepare('SELECT 1 FROM finance_accounts WHERE id = ? AND organization_id = ?')
          .get(cashAcct, actor.organizationId);
        if (!owned) return NextResponse.json({ error: 'Рахунок не знайдено' }, { status: 400 });
      }

      db.prepare(`
        UPDATE app_users
        SET full_name = ?, email = ?, phone = ?, telegram_chat_id = ?, role = ?, is_active = ?, default_cash_account_id = ?, updated_at = datetime('now')
        WHERE id = ? AND organization_id = ?
      `).run(fullName, email, phone, telegramChatId, role, isActive, cashAcct, id, actor.organizationId);
    }

    if (body.permissions_overrides && Array.isArray(body.permissions_overrides)) {
      db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(id);
      const insertOverride = db.prepare(
        'INSERT INTO user_permissions (user_id, permission, granted) VALUES (?, ?, ?)'
      );
      for (const ov of body.permissions_overrides) {
        insertOverride.run(id, ov.permission, ov.granted ? 1 : 0);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('User PUT error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
});

export const deleteUser = withPermission('manage_users', async (
  _request,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
) => {
  try {
    const { id } = await params;

    if (actor.user.id === id) {
      return NextResponse.json({ error: 'Не можна видалити себе' }, { status: 400 });
    }

    const db = getDb();
    const existing = ownedUser(db, actor.organizationId, id);
    if (!existing) return notFound();

    if (existing.role === 'owner' && actor.user.role !== 'owner') {
      return NextResponse.json({ error: 'Не можна видалити Власника' }, { status: 403 });
    }

    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM app_users WHERE id = ? AND organization_id = ?').run(id, actor.organizationId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('User DELETE error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
});
