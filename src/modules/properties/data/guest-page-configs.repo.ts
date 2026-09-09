/**
 * Гостьові сторінки типів номерів — список для екрана налаштувань.
 *
 * ── Чому SQL переїхав із хендлера ───────────────────────────────────────
 *
 * Хендлер загорнутий у `withModule`, а той кличе `cookies()`: поза запитом
 * Next це виняток, тобто сцени на нього не буває взагалі. Твердження, яке
 * неможливо запустити, це не твердження.
 *
 * ── Чому LEFT JOIN, а не список рядків `guest_page_config` ──────────────
 *
 * Довід не мій, він стояв у хендлері й переїхав разом із запитом: рядки
 * створював давно померлий засів, тож готель, заведений після нього, бачив
 * порожній список і не мав куди натиснути. Тип без конфігурації — це тип із
 * порожніми полями, а не невидимий тип (`PUT` уже робить upsert).
 *
 * ── Чому вісь обʼєкта ───────────────────────────────────────────────────
 *
 * Ці рядки несуть коди дверей і паролі Wi-Fi. Готель із двома будинками бачив
 * в одному списку типи обох — тобто коди чужого будинку поруч зі своїми.
 */
import { getSql } from '@core/db/async';
import { propertyScopeFilter, type PropertyScope } from '@core/property-scope';

export async function listGuestPageConfigs(organizationId: string, scope: PropertyScope) {
  const inScope = propertyScopeFilter(scope, 'ut');
  return getSql().rows<Record<string, unknown>>(
    `SELECT gpc.*, ut.id as unit_type_id, ut.name as unit_type_name, ut.code as unit_type_code,
            c.type as category_type, c.name as category_name, c.icon as category_icon
       FROM unit_types ut
       JOIN categories c ON ut.category_id = c.id
       JOIN properties p ON ut.property_id = p.id
       LEFT JOIN guest_page_config gpc ON gpc.unit_type_id = ut.id
      WHERE p.organization_id = ? AND ${inScope.sql}
      ORDER BY c.sort_order, ut.sort_order`,
    [organizationId, ...inScope.params],
  );
}
