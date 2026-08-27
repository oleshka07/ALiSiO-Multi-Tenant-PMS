/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { hashPassword } from '@core/auth';
import { withPermission, type Actor } from '@core/auth/session';
import { getUserPermissions, type PermissionOverride, type Permission } from '@core/auth';
import { LANGUAGES, LANGUAGE_CODES, isLanguage } from '@core/i18n/languages';

// Through the guard rather than a session lookup of its own. The check here
// was correct as far as it went — it proved the person and the permission — but
// it left the tenant unset, so every query below ran with no organization. This
// one survived that because `app_users` is deliberately readable before a
// tenant is known; createUser below did not, because `user_permissions` is not.
export const listUsers = withPermission('manage_users', async (_request: NextRequest, _ctx, actor: Actor) => {
  const currentUser = actor.user;
  try {

    const sql = getSql();
    const users = await sql.rows<any>(`
      SELECT id, organization_id, email, full_name, phone, role, is_active, language, last_login, created_at, updated_at
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
});

export const createUser = withPermission('manage_users', async (request: NextRequest, _ctx, actor: Actor) => {
  const currentUser = actor.user;
  try {

    const body = await request.json();
    const { email, full_name, phone, role, password, language, permissions_overrides } = body;

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

    // Stored lower-cased, and looked for the same way — `login` matches
    // without regard to case, so «Anna@hotel.de» and «anna@hotel.de» are one
    // person as far as signing in is concerned. Checked case-insensitively too,
    // or this would happily create the second row that login can never reach:
    // it takes the first match and has no ORDER BY.
    //
    // Deliberately not scoped to the organization: an address identifies a
    // person across the whole server, because that is all login is given.
    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await sql.row<any>('SELECT id FROM app_users WHERE lower(email) = ?', [normalizedEmail]);
    if (existing) {
      return NextResponse.json({ error: 'Користувач з таким email вже існує' }, { status: 409 });
    }

    const passwordHash = hashPassword(password);
    const id = crypto.randomUUID().replace(/-/g, '').substring(0, 32);

    await sql.run(`
      INSERT INTO app_users (id, organization_id, email, full_name, phone, role, password_hash, language)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, currentUser.organization_id, normalizedEmail, full_name, phone || null, role, passwordHash, language || null]);

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
});
