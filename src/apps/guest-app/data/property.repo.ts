/**
 * Хто ми, коли гість щойно сканував наліпку.
 *
 * Єдиний запит цього застосунку, який виконується БЕЗ орендаря — бо саме він
 * орендаря і встановлює. Далі сторінка йде звичайним `runWithOrganization`.
 */

import { getSql } from '@core/db/async';
import { runWithPublicToken } from '@core/auth/tenant-context';

export interface GuestAppHome {
  organizationId: string;
  propertyId: string;
  propertyName: string;
  /** Країна обʼєкта — від неї залежить мова документів (інваріант 19). */
  country: string | null;
  /** Своя адреса онлайн-модуля готелю, якщо бронювання ще не наше (К8). */
  walkinUrl: string | null;
  /** Чия книга головна: `alisio` | `external` — від цього залежить крок 4/5. */
  systemOfRecord: string;
}

/**
 * Обʼєкт за ключем із адреси.
 *
 * Ключ ставиться ПЕРЕПУСТКОЮ на зʼєднання (`runWithPublicToken`), а не
 * додається умовою `WHERE` поверх звичайного читання — інваріант 14. Різниця
 * не стилістична: на Postgres у `properties` увімкнено RLS, тож читання без
 * орендаря не падає, а тихо віддає порожньо. Запит із `WHERE guest_app_key =
 * ?` і без перепустки на беті знайшов би НІЧОГО, і сторінка казала б «такого
 * готелю немає» про готель, який є, — при цілком зеленому SQLite у розробника.
 *
 * Вікно, у якому ключ щось значить, шириною в один запит: політика звіряє
 * його сама, ми читаємо один рядок і одразу виходимо.
 *
 * Немає рядка — `undefined`, і викликач робить 404. Не «взяти перший», не
 * «взяти єдиний обʼєкт рахунку»: перевірка, яка не знайшла рядка, відмовляє
 * (інваріант 13).
 */
export async function propertyByAppKey(key: string): Promise<GuestAppHome | undefined> {
  const row = await runWithPublicToken(key, () => getSql().row<{
    id: string; organization_id: string; name: string; country: string | null;
    kiosk_walkin_url: string | null; system_of_record: string;
  }>(
    `SELECT id, organization_id, name, country, kiosk_walkin_url, system_of_record
       FROM properties WHERE guest_app_key = ?`,
    [key],
  ));
  if (!row) return undefined;
  return {
    organizationId: row.organization_id,
    propertyId: row.id,
    propertyName: row.name,
    country: row.country,
    walkinUrl: row.kiosk_walkin_url,
    systemOfRecord: row.system_of_record,
  };
}
