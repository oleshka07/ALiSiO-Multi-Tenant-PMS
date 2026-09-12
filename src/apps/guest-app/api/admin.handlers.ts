/**
 * Картка застосунку: які будинки мають адресу, і кнопка її видати.
 *
 * ── Чому екран, а не команда на сервері ─────────────────────────────────
 *
 * Спершу ключ видавав скрипт (`deploy/guest-app-key.sh`), і він НЕ ПРАЦЮВАВ:
 * читав `properties` без орендаря, а на Postgres роль застосунку з порожнім
 * орендарем бачить нуль рядків — мовчки. Оператор дістав порожній перелік і
 * висновок «застосунків немає». Це AGENTS §7 дослівно, і коментар у тому
 * скрипті стверджував протилежне.
 *
 * Тут орендар приходить із СЕСІЇ (інваріант 1), тобто питання про той самий
 * рахунок, у який адміністратор і зайшов.
 *
 * ── Що видача ключа означає ─────────────────────────────────────────────
 *
 * Не «увімкнути»: вмикач — ключ реєстру фіч, і без нього сторінка 404 навіть
 * із виписаним ключем (`data/property.repo.ts`). Ключ — це АДРЕСА, за якою
 * сторінка існує, і він публічний за призначенням: його друкують на наліпці.
 *
 * Заміна (`rotate`) — не «оновити», а ВІДКЛЮЧИТИ надруковані наліпки: усі
 * вони перестають вести куди-небудь тієї ж секунди. Тому окремою дією, а не
 * мовчазним переписуванням.
 */
import { NextResponse } from 'next/server';
import { withOwner, type Actor } from '@core/auth/session';
import { hasFeature } from '@core/features';
import { handleError, refuse } from '@core/http/errors';
import { getSql } from '@core/db/async';
import { ownsProperty } from '@properties/kernel';
import { generateGuestAppKey } from '../domain/key';

const APP = 'guest_app';

export interface GuestAppHouse {
  propertyId: string;
  name: string;
  /** `null` — ключа ще не видано, і сторінки за жодною адресою немає. */
  key: string | null;
  /** Чия книга головна: від цього залежить, продає сторінка чи передає. */
  systemOfRecord: string;
}

/** Будинки рахунку і їхні ключі. */
export const listGuestAppHouses = withOwner(async (_request: Request, _ctx: unknown, actor: Actor) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    const sql = getSql();
    const rows = await sql.rows<{
      id: string; name: string; guest_app_key: string | null; system_of_record: string | null;
    }>(
      `SELECT id, name, guest_app_key, system_of_record
         FROM properties WHERE organization_id = ? ORDER BY name`,
      [actor.organizationId]);
    const houses: GuestAppHouse[] = rows.map((r) => ({
      propertyId: r.id, name: r.name, key: r.guest_app_key,
      systemOfRecord: r.system_of_record ?? 'alisio',
    }));
    return NextResponse.json({ houses });
  } catch (error) {
    return handleError('apps/guest-app listHouses', error, 'Не вдалося прочитати застосунок');
  }
});

/** Видати ключ будинку — або замінити наявний. */
export const issueGuestAppKey = withOwner(async (request: Request, _ctx: unknown, actor: Actor) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const propertyId = String(body.propertyId ?? '').trim();
    const rotate = body.rotate === true;

    // Обʼєкт — СВІЙ. Чужий id відповідає «немає» (інваріант 5): інакше ключ
    // виписався б на будинок сусіднього рахунку.
    if (!propertyId || !(await ownsProperty(actor.organizationId, propertyId))) {
      refuse('Не знайдено', 404);
    }

    const sql = getSql();
    const has = await sql.row<{ guest_app_key: string | null }>(
      'SELECT guest_app_key FROM properties WHERE id = ? AND organization_id = ?',
      [propertyId, actor.organizationId]);
    if (!has) refuse('Не знайдено', 404);

    // Ключ уже є, заміни не просили — віддаємо наявний. Мовчки перевипустити
    // означало б зробити надруковані наліпки непрацюючими за одне натискання
    // кнопки, підписаної «видати».
    if (has.guest_app_key && !rotate) {
      return NextResponse.json({ key: has.guest_app_key, created: false });
    }

    const key = generateGuestAppKey();
    await sql.run(
      'UPDATE properties SET guest_app_key = ? WHERE id = ? AND organization_id = ?',
      [key, propertyId, actor.organizationId]);

    // Читаємо НАЗАД окремим запитом: `UPDATE` без помилки не доводить, що
    // рядок змінився — політика могла відхилити його мовчки (рід И4).
    const back = await sql.row<{ guest_app_key: string | null }>(
      'SELECT guest_app_key FROM properties WHERE id = ? AND organization_id = ?',
      [propertyId, actor.organizationId]);
    if (back?.guest_app_key !== key) refuse('Ключ не записався. Спробуйте ще раз', 409);

    return NextResponse.json({ key, created: true });
  } catch (error) {
    return handleError('apps/guest-app issueKey', error, 'Не вдалося видати ключ');
  }
});
