import { getSql } from '@core/db/async';

/**
 * Зміст гостьової сторінки на рівні ТИПУ номера — писач модуля.
 *
 * ── Навіщо окремий файл, коли пише хендлер ──────────────────────────────
 *
 * `guest_page_config` належить `properties`: це єдиний модуль, який у неї
 * пише, і саме тому `check-boundaries` бачить трьох читачів ззовні
 * (резолвер гостьової, публічний календар віджета, `check-isolation`) як
 * пробої — тобто як борг, який колись закриють двері.
 *
 * Той сигнал ламається від будь-якого НОВОГО писача, хоч би й фікстури: щойно
 * в таблицю пише другий модуль, вона стає «спільною», і три пробої зникають
 * із звіту як прогрес, якого не було (клас INC-018). Тому перевірка рівнів
 * гостьової сторінки сіє свій рядок ЧЕРЕЗ ЦІ ДВЕРІ, а не власним SQL.
 *
 * Хендлер `PUT /api/guest-page-config/[unitTypeId]` поки пише сам: у ньому
 * жива логіка перекладів і часткового оновлення, і переносити її сюди —
 * окрема правка, не ця. Коли до нього дійдуть руки, він має кликати саме цю
 * функцію.
 */
export async function upsertGuestPageConfig(
  unitTypeId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const sql = getSql();
  const allowed = ['amenities', 'check_in_instructions', 'external_amenities', 'faq_items', 'rules',
    'wifi_network', 'wifi_password', 'restaurant_name', 'restaurant_hours', 'restaurant_menu_url',
    'useful_info', 'lock_code', 'maps_url', 'territory_map_url', 'pets_policy', 'entry_photo_url'];
  const cols = allowed.filter((c) => fields[c] !== undefined);

  const existing = await sql.row<any>('SELECT id FROM guest_page_config WHERE unit_type_id = ?', [unitTypeId]);
  if (existing) {
    if (cols.length === 0) return;
    await sql.run(
      `UPDATE guest_page_config SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE unit_type_id = ?`,
      [...cols.map((c) => fields[c] ?? null), unitTypeId]);
    return;
  }
  await sql.run(
    `INSERT INTO guest_page_config (unit_type_id${cols.length ? `, ${cols.join(', ')}` : ''})
     VALUES (?${cols.map(() => ', ?').join('')})`,
    [unitTypeId, ...cols.map((c) => fields[c] ?? null)]);
}
