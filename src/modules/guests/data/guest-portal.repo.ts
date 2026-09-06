/* eslint-disable @typescript-eslint/no-explicit-any */
import { unitTypeAmenities } from '@properties';
import { getSql } from '@core/db/async';
import {
  resolveSections, isKnownSection,
  type ResolvedSection, type StoredSectionRow,
} from '../domain/guest-page-sections';

/**
 * The guest page's sections for one property: the registry with this hotel's
 * differences applied. Callers get the final answer — enabled, order, locked —
 * never the raw rows, so nobody else re-implements the merge.
 */
export async function getGuestPageSections(
  propertyId: string,
  propertyCountry?: string | null,
): Promise<ResolvedSection[]> {
  const sql = getSql();
  let rows: StoredSectionRow[] = [];
  try {
    rows = await sql.rows<StoredSectionRow>(
      'SELECT section, enabled, sort_order, config FROM guest_page_sections WHERE property_id = ?',
      [propertyId]);
  } catch { /* a database from before migration 0022 — registry defaults */ }
  return resolveSections(rows, { propertyCountry });
}

/**
 * Store one section's difference from the registry. Unknown keys are refused,
 * not stored: the registry decides what exists, and a typo that quietly lands
 * in the table would read as "configured, does nothing".
 */
export async function saveGuestPageSection(
  organizationId: string,
  propertyId: string,
  input: { section: string; enabled?: boolean; sortOrder?: number | null; config?: Record<string, unknown> | null },
): Promise<boolean> {
  if (!isKnownSection(input.section)) return false;
  const sql = getSql();
  const existing = await sql.row<any>(
    'SELECT id, enabled, sort_order, config FROM guest_page_sections WHERE property_id = ? AND section = ?',
    [propertyId, input.section]);
  const enabled = input.enabled === undefined
    ? (existing ? Number(existing.enabled) : 1)
    : (input.enabled ? 1 : 0);
  const sortOrder = input.sortOrder === undefined
    ? (existing?.sort_order ?? null)
    : input.sortOrder;
  const config = input.config === undefined
    ? (existing?.config ?? null)
    : (input.config == null ? null : JSON.stringify(input.config));
  if (existing) {
    await sql.run(
      `UPDATE guest_page_sections SET enabled = ?, sort_order = ?, config = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND property_id = ?`,
      [enabled, sortOrder, config, existing.id, propertyId]);
  } else {
    await sql.run(
      `INSERT INTO guest_page_sections (organization_id, property_id, section, enabled, sort_order, config)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [organizationId, propertyId, input.section, enabled, sortOrder, config]);
  }
  return true;
}

export async function getReservationByToken(token: string) {
  const sql = getSql();
  const row = await sql.row<any>(`
    SELECT
      r.id, r.check_in, r.check_out, r.nights, r.adults, r.children, r.infants,
      r.status, r.payment_status, r.total_price, r.currency, r.notes, r.source,
      r.guest_page_expires_at, r.property_id,
      g.id as guest_id, g.first_name, g.last_name, g.email as guest_email, g.phone as guest_phone,
      u.id as unit_id, u.name as unit_name, u.code as unit_code, u.beds,
      c.id as category_id, c.name as category_name, c.type as category_type, c.icon as category_icon, c.color as category_color,
      ut.id as unit_type_id, ut.name as unit_type_name, ut.code as unit_type_code,
      ut.max_adults, ut.max_children, ut.max_occupancy, ut.base_occupancy,
      ut.beds_single, ut.beds_double, ut.beds_sofa, ut.extra_bed_available, ut.description as unit_type_description
      p.name as property_name, p.address as property_address, p.city as property_city,
      p.country as property_country, p.phone as property_phone, p.email as property_email,
      p.check_in_time, p.check_out_time,
      p.organization_id,
      o.language as organization_language
    FROM reservations r
    JOIN guests g ON r.guest_id = g.id
    LEFT JOIN units u ON r.unit_id = u.id
    LEFT JOIN categories c ON u.category_id = c.id
    LEFT JOIN unit_types ut ON u.unit_type_id = ut.id
    JOIN properties p ON r.property_id = p.id
    JOIN organizations o ON p.organization_id = o.id
    WHERE r.guest_page_token = ?
  `, [token]) as any;

  // Diagnostic: when the full JOIN returns nothing, separate "token doesn't
  // exist" from "token exists but a referenced row is missing/broken" — the
  // latter looks identical to the user (Booking not found) without logs.
  if (!row) {
    const bareRow = await sql.row<any>('SELECT id, guest_id, unit_id, property_id FROM reservations WHERE guest_page_token = ?', [token]) as any;
    if (bareRow) {
      console.error(
        `[GuestPortal] Reservation ${bareRow.id} exists for token ${token.slice(0, 6)}… but ` +
        `the JOIN returned nothing — check guest(${bareRow.guest_id}), unit(${bareRow.unit_id}), ` +
        `property(${bareRow.property_id}) and the unit's category/unit_type rows.`
      );
    }
  }
  return row;
}

// Cheap existence check: used by the portal handler to distinguish
// "this token has never been issued" from "the token maps to a reservation
// whose related rows are broken (data integrity issue)".
export async function getReservationStubByToken(token: string) {
  const sql = getSql();
  return await sql.row<any>('SELECT id, guest_id, unit_id, property_id FROM reservations WHERE guest_page_token = ?', [token]) as { id: string; guest_id: string; unit_id: string; property_id: string } | undefined;
}

/**
 * What an expired guest page offers to book again.
 *
 * The property is required. Without it this listed every `unit_types` row on
 * the server: the guest of one hotel opened a stale link and was invited to
 * rebook a neighbour's rooms, under this hotel's name and next to this hotel's
 * phone number — the rest of that response is all `reservation.*`. Every other
 * read on this page already takes `reservation.property_id`; this one did not,
 * and it is the only list on the page a guest is meant to act on.
 */
export async function getUnitTypesForRebooking(propertyId: string) {
  const sql = getSql();
  return await sql.rows<any>(`
    SELECT ut.id, ut.name, ut.code, ut.description, ut.max_adults, ut.max_children, ut.base_occupancy,
           c.name as category_name, c.type as category_type, c.icon as category_icon
    FROM unit_types ut
    JOIN categories c ON ut.category_id = c.id
    WHERE ut.property_id = ?
    ORDER BY c.type, ut.sort_order
  `, [propertyId]);
}

export async function getRegisteredGuests(reservationId: string) {
  const sql = getSql();
  return await sql.rows<any>('SELECT * FROM reservation_guests WHERE reservation_id = ? ORDER BY created_at', [reservationId]);
}

export async function getPaymentsSummary(reservationId: string) {
  const sql = getSql();
  // Post PR #6: sum from fin_operations. Income = paid, refund-expense = refunded.
  return await sql.row<any>(`
    SELECT
      COALESCE(SUM(CASE WHEN op_type = 'income' THEN amount ELSE 0 END), 0) as total_paid,
      COALESCE(SUM(CASE WHEN op_type = 'expense' AND payment_subtype = 'refund' THEN amount ELSE 0 END), 0) as total_refunded
    FROM fin_operations
    WHERE reservation_id = ? AND status = 'completed'
  `, [reservationId]) as any;
}

export async function getUnitTypePhotos(unitTypeId: string) {
  const sql = getSql();
  return await sql.rows<any>('SELECT * FROM unit_type_photos WHERE unit_type_id = ? ORDER BY sort_order', [unitTypeId]);
}

export async function getPropertyPhotos(propertyId: string) {
  const sql = getSql();
  return await sql.rows<any>('SELECT * FROM property_photos WHERE property_id = ? ORDER BY sort_order', [propertyId]);
}

export async function getAvailableServices(propertyId: string, categoryType: string) {
  const sql = getSql();
  return await sql.rows<any>("SELECT * FROM additional_services WHERE property_id = ? AND is_active = TRUE AND (available_for = 'all' OR available_for = ?) ORDER BY sort_order", [propertyId, categoryType]);
}

export async function getOrderedServices(reservationId: string) {
  const sql = getSql();
  return await sql.rows<any>(`
    SELECT so.id, so.service_id, so.quantity, so.total_price, so.status,
           so.payment_status, so.service_date, so.created_at,
           ads.name as service_name, ads.name_en, ads.icon as service_icon,
           ads.currency
    FROM service_orders so
    JOIN additional_services ads ON so.service_id = ads.id
    WHERE so.reservation_id = ?
    ORDER BY so.created_at DESC
  `, [reservationId]);
}

export async function getGuestPageConfig(unitTypeId: string, propertyId: string, unitId?: string) {
  const sql = getSql();
  const unitTypeConfig = await sql.row<any>('SELECT * FROM guest_page_config WHERE unit_type_id = ?', [unitTypeId]) as any || null;

  // Per-unit overrides (lock_code, entry_photo_url, view, wi-fi — 0110).
  //
  // Три рівні, і вони не рівноцінні: обʼєкт каже «як тут узагалі», тип —
  // «як у таких номерах», номер — «як саме у цьому». Мережа й замок ЦЬОГО
  // номера перемагають обидва верхні: в апарт-готелі мережа кімнатна, а код
  // замка типу — це код, який не відчиняє двері гостя.
  let unitOverrides: any = null;
  if (unitId) {
    try {
      unitOverrides = await sql.row<any>(
        'SELECT lock_code, entry_photo_url, view, wifi_network, wifi_password FROM units WHERE id = ?',
        [unitId]) as any;
    } catch { /* columns may not exist yet */ }
  }

  let propertyConfig: any = null;
  try {
    propertyConfig = await sql.row<any>('SELECT * FROM property_guest_config WHERE property_id = ?', [propertyId]) as any || null;
  } catch { /* table may not exist yet */ }

  /**
   * Мережа береться ОДНИМ рівнем: назва й пароль разом або жодного (О2).
   *
   * Тут стояли два незалежні `||`, і готель, що вписав мережу на типі й не
   * вписав пароль, віддавав гостю НАЗВУ ТИПУ З ПАРОЛЕМ ОБʼЄКТА. Гість вводить
   * пароль, який не підходить, і о другій ночі дзвонить на рецепцію. Рівень
   * номера це правило вже мав (нижче); тут його бракувало — рівно та
   * ситуація, якою О2 і обґрунтоване.
   */
  const wifiFrom = (...levels: Array<{ wifi_network?: unknown; wifi_password?: unknown } | null | undefined>) => {
    for (const level of levels) {
      if (level?.wifi_network && level?.wifi_password) {
        return { wifi_network: level.wifi_network, wifi_password: level.wifi_password };
      }
    }
    return { wifi_network: null, wifi_password: null };
  };

  const merged = !propertyConfig ? { ...unitTypeConfig } : {
    ...unitTypeConfig,
    ...wifiFrom(unitTypeConfig, propertyConfig),
    restaurant_name: propertyConfig.restaurant_name,
    restaurant_hours: propertyConfig.restaurant_hours,
    restaurant_menu_url: propertyConfig.restaurant_menu_url,
    rules: propertyConfig.rules,
    useful_info: propertyConfig.useful_info,
    faq_items: propertyConfig.faq_items,
    maps_url: unitTypeConfig?.maps_url || propertyConfig.maps_url,
    territory_map_url: unitTypeConfig?.territory_map_url || propertyConfig.territory_map_url,
    pets_policy: unitTypeConfig?.pets_policy || propertyConfig.pets_policy || 'welcome',
    parking_info: propertyConfig.parking_info,
    parking_photo_url: propertyConfig.parking_photo_url,
    parking_maps_url: propertyConfig.parking_maps_url,
    video_guide_url: propertyConfig.video_guide_url,
    emergency_phone: propertyConfig.emergency_phone,
    // Null when the hotel has not entered one — the guest page hides the tab
    // rather than opening a chat with nobody. It used to be a literal in the
    // page: one number, every hotel.
    whatsapp_phone: propertyConfig.whatsapp_phone,
    weather_lat: propertyConfig.weather_lat,
    weather_lon: propertyConfig.weather_lon,
    amenities: unitTypeConfig?.amenities,
    check_in_instructions: unitTypeConfig?.check_in_instructions,
    lock_code: unitTypeConfig?.lock_code,
    entry_photo_url: unitTypeConfig?.entry_photo_url,
  };

  // Per-unit override: if unit has its own lock_code or entry_photo_url, use it
  if (unitOverrides?.lock_code) merged.lock_code = unitOverrides.lock_code;
  if (unitOverrides?.entry_photo_url) merged.entry_photo_url = unitOverrides.entry_photo_url;
  // Рівень номера — тим самим правилом, що й два верхні: цілим або ніяк.
  if (unitOverrides?.wifi_network && unitOverrides?.wifi_password) {
    merged.wifi_network = unitOverrides.wifi_network;
    merged.wifi_password = unitOverrides.wifi_password;
  }
  if (unitOverrides?.view) merged.unit_view = unitOverrides.view;

  // Зручності типу — з довідника (Блок 5a, 2.2), а не з текстового поля.
  //
  // Старе `guest_page_config.amenities` лишається як є і показується далі:
  // це вільний текст, який готель писав роками, і мовчки його втратити було б
  // гірше, ніж мати два джерела на екрані. Нове поле окреме й називається
  // інакше, тож сторінка показує «список» там, де він заповнений, і текст —
  // де ні; переїзд одного в друге — крок гостьової сторінки, не цього блоку.
  try {
    const organizationId = (await sql.row<any>(
      'SELECT organization_id FROM properties WHERE id = ?', [propertyId]) as any)?.organization_id;
    if (organizationId) {
      merged.amenity_list = await unitTypeAmenities(String(organizationId), unitTypeId);
    }
  } catch { /* модуль зручностей ще не мігрований — сторінка живе без списку */ }

  return merged;
}
