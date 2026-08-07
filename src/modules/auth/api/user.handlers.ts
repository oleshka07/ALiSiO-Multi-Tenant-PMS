/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSql } from '@core/db/async';
import { hashPassword } from '@core/auth';
import { LANGUAGE_CODES, isLanguage } from '@core/i18n/languages';
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
async function ownedUser(organizationId: string, id: string): Promise<any> {
  const sql = getSql();
  return await sql.row<any>('SELECT * FROM app_users WHERE id = ? AND organization_id = ?', [id, organizationId]);
}

export const getUser = withPermission('manage_users', async (
  _request,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
) => {
  try {
    const { id } = await params;
    const sql = getSql();
    const user = await sql.row<any>(`
      SELECT id, organization_id, email, full_name, phone, telegram_chat_id, role, is_active,
             default_cash_account_id, (payment_pin_hash IS NOT NULL) AS has_payment_pin,
             last_login, created_at, updated_at
      FROM app_users WHERE id = ? AND organization_id = ?
    `, [id, actor.organizationId]);

    if (!user) return notFound();

    const overrides = await sql.rows<any>('SELECT permission, granted FROM user_permissions WHERE user_id = ?', [id]);

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
    const sql = getSql();
    const existing = await ownedUser(actor.organizationId, id);
    if (!existing) return notFound();

    const body = await request.json();

    if (body.password) {
      const passwordHash = hashPassword(body.password);
      await sql.run("UPDATE app_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [passwordHash, id]);
    }

    // Interface language for this person. Null or empty clears the override
    // and puts them back on the hotel's base language — which is not the same
    // as setting the same code today, because the hotel may change its later.
    if (body.language !== undefined) {
      if (body.language === null || body.language === '') {
        await sql.run('UPDATE app_users SET language = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
      } else if (isLanguage(body.language)) {
        await sql.run('UPDATE app_users SET language = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [body.language, id]);
      } else {
        return NextResponse.json(
          { error: `Мова не підтримується. Доступні: ${LANGUAGE_CODES.join(', ')}` },
          { status: 400 },
        );
      }
    }

    // The PIN a receptionist types to confirm a cash payment from the booking
    // widget. Stored hashed like a password, because it is one — it authorises
    // marking money as received. Sending null clears it.
    if (body.payment_pin !== undefined) {
      if (body.payment_pin === null || body.payment_pin === '') {
        await sql.run("UPDATE app_users SET payment_pin_hash = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
      } else {
        const pin = String(body.payment_pin).trim();
        if (!/^\d{4,8}$/.test(pin)) {
          return NextResponse.json({ error: 'PIN має бути 4–8 цифр' }, { status: 400 });
        }
        await sql.run("UPDATE app_users SET payment_pin_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [bcrypt.hashSync(pin, 10), id]);
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
        const owned = await sql.row<any>('SELECT 1 FROM finance_accounts WHERE id = ? AND organization_id = ?', [cashAcct, actor.organizationId]);
        if (!owned) return NextResponse.json({ error: 'Рахунок не знайдено' }, { status: 400 });
      }

      await sql.run(`
        UPDATE app_users
        SET full_name = ?, email = ?, phone = ?, telegram_chat_id = ?, role = ?, is_active = ?, default_cash_account_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?
      `, [fullName, email, phone, telegramChatId, role, isActive, cashAcct, id, actor.organizationId]);
    }

    if (body.permissions_overrides && Array.isArray(body.permissions_overrides)) {
      await sql.tx(async (t) => {
        await t.run('DELETE FROM user_permissions WHERE user_id = ?', [id]);
        for (const ov of body.permissions_overrides) {
          await t.run(
            'INSERT INTO user_permissions (user_id, permission, granted) VALUES (?, ?, ?)',
            [id, ov.permission, ov.granted ? 1 : 0],
          );
        }
      });
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

    const sql = getSql();
    const existing = await ownedUser(actor.organizationId, id);
    if (!existing) return notFound();

    if (existing.role === 'owner' && actor.user.role !== 'owner') {
      return NextResponse.json({ error: 'Не можна видалити Власника' }, { status: 403 });
    }

    await sql.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    await sql.run('DELETE FROM user_permissions WHERE user_id = ?', [id]);
    await sql.run('DELETE FROM app_users WHERE id = ? AND organization_id = ?', [id, actor.organizationId]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('User DELETE error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
});
