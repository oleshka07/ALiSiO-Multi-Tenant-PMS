/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSql } from '@core/db/async';
import { getSessionUser, hashPassword } from '@core/auth';
import { getUserPermissions, type PermissionOverride, type Permission } from '@core/auth';
import { LANGUAGES, LANGUAGE_CODES, isLanguage } from '@core/i18n/languages';

export async function listUsers() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('session_id')?.value;
    const currentUser = await getSessionUser(sessionId);

    if (!currentUser || !currentUser.permissions.includes('manage_users')) {
      return NextResponse.json({ error: 'Доступ заборонено' }, { status: 403 });
    }

    const sql = getSql();
    const users = await sql.rows<any>(`
      SELECT id, organization_id, email, full_name, phone, telegram_chat_id, role, is_active, language, last_login, created_at, updated_at
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

    // The organization's language rides along so the screen can name the
    // default instead of showing an empty select.
    return NextResponse.json({
      users: usersWithPermissions,
      organizationLanguage: currentUser.organization_language,
      languages: LANGUAGE_CODES.map((code) => ({ code, native: LANGUAGES[code].native })),
    });
  } catch (error) {
    console.error('Users GET error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
}

export async function createUser(request: Request) {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('session_id')?.value;
    const currentUser = await getSessionUser(sessionId);

    if (!currentUser || !currentUser.permissions.includes('manage_users')) {
      return NextResponse.json({ error: 'Доступ заборонено' }, { status: 403 });
    }

    const body = await request.json();
    const { email, full_name, phone, telegram_chat_id, role, password, language, permissions_overrides } = body;

    // Null or absent means the person follows the hotel's base language, which
    // is what a new colleague should get unless someone says otherwise.
    if (language != null && language !== '' && !isLanguage(language)) {
      return NextResponse.json(
        { error: `Мова не підтримується. Доступні: ${LANGUAGE_CODES.join(', ')}` },
        { status: 400 },
      );
    }

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
      INSERT INTO app_users (id, organization_id, email, full_name, phone, telegram_chat_id, role, password_hash, language)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, currentUser.organization_id, email, full_name, phone || null, telegram_chat_id || null, role, passwordHash, language || null]);

    if (permissions_overrides && Array.isArray(permissions_overrides)) {
      await sql.tx(async (t) => {
        for (const ov of permissions_overrides) {
          await t.run(
            'INSERT INTO user_permissions (user_id, permission, granted) VALUES (?, ?, ?) ON CONFLICT (user_id, permission) DO UPDATE SET granted = excluded.granted',
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
