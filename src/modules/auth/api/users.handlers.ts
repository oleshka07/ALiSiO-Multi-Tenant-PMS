/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSql } from '@core/db/async';
import { getSessionUser, hashPassword } from '@core/auth';
import { getUserPermissions, type PermissionOverride, type Permission } from '@core/auth';

export async function listUsers() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('session_id')?.value;
    const currentUser = getSessionUser(sessionId);

    if (!currentUser || !currentUser.permissions.includes('manage_users')) {
      return NextResponse.json({ error: 'Доступ заборонено' }, { status: 403 });
    }

    const sql = getSql();
    const users = await sql.rows<any>(`
      SELECT id, organization_id, email, full_name, phone, telegram_chat_id, role, is_active, last_login, created_at, updated_at
      FROM app_users
      WHERE organization_id = ?
      ORDER BY
        CASE role
          WHEN 'owner' THEN 1
          WHEN 'director' THEN 2
          WHEN 'manager' THEN 3
          WHEN 'receptionist' THEN 4
          WHEN 'accountant' THEN 5
          WHEN 'housekeeper' THEN 6
          WHEN 'maintenance' THEN 7
        END,
        full_name
    `, [currentUser.organization_id]);

    const usersWithPermissions = await Promise.all(users.map(async (u: any) => {
      const overrides: PermissionOverride[] = (await sql.rows<any>('SELECT permission, granted FROM user_permissions WHERE user_id = ?', [u.id])).map((o: any) => ({
        permission: o.permission as Permission,
        granted: o.granted === 1,
      }));
      const permissions = getUserPermissions(u.role, overrides);
      const overridesList = overrides.map((o) => ({ permission: o.permission, granted: o.granted }));

      return { ...u, permissions, overrides: overridesList };
    }));

    return NextResponse.json({ users: usersWithPermissions });
  } catch (error) {
    console.error('Users GET error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
}

export async function createUser(request: Request) {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('session_id')?.value;
    const currentUser = getSessionUser(sessionId);

    if (!currentUser || !currentUser.permissions.includes('manage_users')) {
      return NextResponse.json({ error: 'Доступ заборонено' }, { status: 403 });
    }

    const body = await request.json();
    const { email, full_name, phone, telegram_chat_id, role, password, permissions_overrides } = body;

    if (!email || !full_name || !role || !password) {
      return NextResponse.json({ error: "Заповніть усі обов'язкові поля" }, { status: 400 });
    }

    if (role === 'owner' && currentUser.role !== 'owner') {
      return NextResponse.json({ error: 'Тільки Власник може створювати інших Власників' }, { status: 403 });
    }

    const sql = getSql();

    const existing = await sql.row<any>('SELECT id FROM app_users WHERE email = ?', [email]);
    if (existing) {
      return NextResponse.json({ error: 'Користувач з таким email вже існує' }, { status: 409 });
    }

    const passwordHash = hashPassword(password);
    const id = crypto.randomUUID().replace(/-/g, '').substring(0, 32);

    await sql.run(`
      INSERT INTO app_users (id, organization_id, email, full_name, phone, telegram_chat_id, role, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, currentUser.organization_id, email, full_name, phone || null, telegram_chat_id || null, role, passwordHash]);

    if (permissions_overrides && Array.isArray(permissions_overrides)) {
      await sql.tx(async (t) => {
        for (const ov of permissions_overrides) {
          await t.run(
            'INSERT OR REPLACE INTO user_permissions (user_id, permission, granted) VALUES (?, ?, ?)',
            [id, ov.permission, ov.granted ? 1 : 0],
          );
        }
      });
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('Users POST error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
}
