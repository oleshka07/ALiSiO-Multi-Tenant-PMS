import { getSql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';

/**
 * Обʼєкт і його типи номерів — у тому вигляді, у якому їх треба знати
 * модулю каналів.
 *
 * Шов-близнюк до `propertyRatePlans()` (`@pricing`) і з тієї ж причини:
 * модуль каналів не читає таблиць обʼєкта навпростець. Тут — фізичний фонд і
 * місткість, там — тарифи й ціни; разом вони складають каталог, який
 * заводиться в менеджері каналів.
 *
 * ── Скільки номерів — це COUNT, а не колонка ────────────────────────────
 *
 * `count_of_rooms` у менеджера каналів впливає на рахунок і на овербукінг:
 * завищене число продає номери, яких немає. Колонки «скільки номерів цього
 * типу» в нас немає й не треба — є рядки `units`, і саме вони правда.
 * Неактивні не рахуються: номер, виведений із фонду, не продається.
 *
 * ── Порожній список — нормальна відповідь ───────────────────────────────
 *
 * Для обʼєкта без типів і для ЧУЖОГО обʼєкта однаково. Друге не помилка
 * виклику, а межа орендаря: `property_id` приходить іззовні, тож обмеження
 * тут явне, а не покладене на політику (на SQLite політик немає, а SQLite
 * стоїть у розробки й у CI).
 */

export interface CatalogUnitTypeRow {
  id: string;
  code: string;
  name: string;
  /** Скільки ФІЗИЧНИХ номерів цього типу зараз у фонді. */
  roomCount: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  /** Скільки осіб селиться за замовчуванням. Ніколи не більше за дорослих. */
  baseOccupancy: number;
}

export interface CatalogPropertyRow {
  id: string;
  title: string;
  city: string | null;
  country: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

/** Обʼєкт орендаря. `null`, якщо це чужий обʼєкт або його немає. */
export async function catalogProperty(propertyId: string): Promise<CatalogPropertyRow | null> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('property catalog: read without a tenant');

  const sql = getSql();
  const row = await sql.row<any>(
    `SELECT id, name, city, country, address, email, phone
       FROM properties
      WHERE id = ? AND organization_id = ?`,
    [propertyId, organizationId],
  ) as Record<string, unknown> | undefined;

  if (!row) return null;
  return {
    id: String(row.id),
    title: String(row.name),
    city: row.city == null ? null : String(row.city),
    country: row.country == null ? null : String(row.country),
    address: row.address == null ? null : String(row.address),
    email: row.email == null ? null : String(row.email),
    phone: row.phone == null ? null : String(row.phone),
  };
}

/**
 * Типи номерів обʼєкта з фактичною кількістю номерів у кожному.
 *
 * Вимкнені типи не повертаються: продати через канал те, що готель вимкнув,
 * — це бронь, якої він не чекає. Тип із нульовим фондом повертається (це
 * заготовка оператора, і про неї має бути сказано), а рішення не везти його
 * ухвалює той, хто читає.
 */
export async function catalogUnitTypes(propertyId: string): Promise<CatalogUnitTypeRow[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('property catalog: read without a tenant');

  const sql = getSql();
  const rows = await sql.rows<any>(
    `SELECT ut.id, ut.code, ut.name, ut.max_adults, ut.max_children,
            ut.max_occupancy, ut.base_occupancy,
            (SELECT COUNT(*) FROM units u
              WHERE u.unit_type_id = ut.id AND u.is_active = TRUE) AS room_count
       FROM unit_types ut
       JOIN properties p ON p.id = ut.property_id
      WHERE ut.property_id = ? AND p.organization_id = ? AND ut.is_active = TRUE
      ORDER BY ut.sort_order, ut.code`,
    [propertyId, organizationId],
  ) as Record<string, unknown>[];

  return rows.map((row) => {
    const maxAdults = Math.max(1, Number(row.max_adults) || 1);
    return {
      id: String(row.id),
      code: String(row.code ?? ''),
      name: String(row.name ?? ''),
      roomCount: Number(row.room_count) || 0,
      maxAdults,
      maxChildren: Math.max(0, Number(row.max_children) || 0),
      maxOccupancy: Math.max(1, Number(row.max_occupancy) || maxAdults),
      // Менеджер каналів відхиляє заселеність за замовчуванням понад
      // кількість дорослих місць — і валить створення всього каталогу.
      baseOccupancy: Math.min(maxAdults, Math.max(1, Number(row.base_occupancy) || 1)),
    };
  });
}
