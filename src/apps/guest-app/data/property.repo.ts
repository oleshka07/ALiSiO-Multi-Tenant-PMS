/**
 * Хто ми, коли гість щойно сканував наліпку.
 *
 * Єдиний запит цього застосунку, який виконується БЕЗ орендаря — бо саме він
 * орендаря і встановлює. Далі сторінка йде звичайним `runWithOrganization`.
 */

import { getSql } from '@core/db/async';
import { runWithPublicToken } from '@core/auth/tenant-context';
import { hasFeature } from '@core/features';

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

  // ── Варта застосунку, і вона ОДНА на все ────────────────────────────────
  //
  // Через цю функцію проходять і сторінка `/stay/<ключ>`, і всі пʼять
  // публічних маршрутів воріт — іншого шляху до орендаря в них немає. Тому
  // ключ реєстру фіч питається саме тут, а не в кожному хендлері: варта, яку
  // треба не забути поставити в шостому місці, рано чи пізно не ставиться.
  //
  // Той самий взірець, що в кіоска (`requireDevice` → `hasFeature`), і той
  // самий довід: біля телефона гостя немає людини з сесією, тож `withModule`
  // сюди не підходить.
  //
  // Вимкнено — `undefined`, тобто 404 всюди: і на сторінці, і в маршрутах.
  // Прапорець без варти це перемикач-обманка (П5), а за цим стоїть поверхня,
  // з якої видно назву готелю, його вільні номери й ціни. Ключ, виписаний
  // наперед, сам по собі нічого не відчиняє.
  if (!(await hasFeature(String(row.organization_id), 'guest_app'))) return undefined;

  return {
    organizationId: row.organization_id,
    propertyId: row.id,
    propertyName: row.name,
    country: row.country,
    walkinUrl: row.kiosk_walkin_url,
    systemOfRecord: row.system_of_record,
  };
}
