/**
 * Кандидати на «це моя бронь» — і чому їх спершу звужує ВІКНО.
 *
 * Порівняння телефона йде за останніми шістьма цифрами, а це неможливо
 * зробити переносно в SQL: SQLite і Postgres чистять рядок від нецифр
 * по-різному, і вираз, написаний під один, на другому мовчки не збігається
 * НІКОЛИ — тобто гість, чия бронь у базі є, чув би «не знайдено» лише на
 * проді. Тому цифри рахує домен (одне місце на обидва рушії), а запит віддає
 * КАНДИДАТІВ.
 *
 * Це безпечно рівно тому, що вікно вузьке: заїзди ±1 день ЦЬОГО обʼєкта — це
 * одиниці рядків, а не таблиця. Без вікна такий підхід означав би вичитати
 * всіх гостей готелю на кожен натиск.
 */

import { getSql } from '@core/db/async';

export interface LookupCandidate {
  reservationId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  guestPageToken: string | null;
}

/**
 * Заїзди обʼєкта у вікні. Орендар — з контексту (`runWithOrganization`),
 * будинок — параметром: ключ із наліпки називає КОНКРЕТНИЙ корпус, і бронь
 * сусіднього корпусу того ж рахунку тут не своя (INC-029).
 *
 * Скасовані й виїхалі не беруться: гість, який стоїть перед дверима, питає
 * про бронь, за якою він ЗАЇЖДЖАЄ.
 */
export async function candidatesInWindow(input: {
  organizationId: string;
  propertyId: string;
  from: string;
  to: string;
}): Promise<LookupCandidate[]> {
  const rows = await getSql().rows<{
    id: string; first_name: string | null; last_name: string | null;
    phone: string | null; guest_page_token: string | null;
  }>(`
    SELECT r.id, g.first_name, g.last_name, g.phone, r.guest_page_token
      FROM reservations r
      LEFT JOIN guests g ON g.id = r.guest_id
     WHERE r.organization_id = ?
       AND r.property_id = ?
       AND r.check_in >= ? AND r.check_in <= ?
       AND r.status IN ('confirmed', 'tentative', 'checked_in')
  `, [input.organizationId, input.propertyId, input.from, input.to]);
  return rows.map((r) => ({
    reservationId: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    guestPageToken: r.guest_page_token,
  }));
}
