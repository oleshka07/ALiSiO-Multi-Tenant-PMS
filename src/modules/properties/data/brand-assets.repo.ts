/**
 * Зображення обʼєкта за ролями — читання й запис.
 *
 * Орендар названий у КОЖНОМУ запиті, а не лише в політиці: на SQLite політик
 * немає, а SQLite це вся розробка й частина CI (рід INC-014). Плюс вісь
 * ОБʼЄКТА: право «керувати обʼєктами» каже, що оператор може, але не каже —
 * чиїм; чужий `property_id` не має мовчки дати чужі зображення.
 */
import { getSql } from '@core/db/async';
import { readBrandAssetRole, readBrandAssets, type BrandAssets } from '@core/brand-assets';
import { readBrandLogoUrl } from '@core/brand-palettes';

/** Усе, що готель завантажив для цього обʼєкта. Кличеться під орендарем. */
export async function brandAssetsOf(
  organizationId: string, propertyId: string,
): Promise<BrandAssets> {
  const rows = await getSql().rows<{ role: string; url: string }>(
    `SELECT a.role, a.url
       FROM property_brand_assets a
      WHERE a.property_id = ? AND a.organization_id = ?`,
    [propertyId, organizationId]);
  return readBrandAssets(rows);
}

/**
 * Поставити або замінити зображення однієї ролі. Порожня адреса — ПРИБРАТИ.
 *
 * Невідома роль або адреса, яку не можна дати в `img src`, — названа відмова
 * викликачу (`null`), а не тихий пропуск: оператор натиснув «зберегти» і має
 * дізнатись, що не збереглось.
 */
export async function setBrandAsset(
  organizationId: string, propertyId: string, rawRole: unknown, rawUrl: unknown,
): Promise<'saved' | 'removed' | 'bad-role' | 'bad-url'> {
  const role = readBrandAssetRole(rawRole);
  if (!role) return 'bad-role';

  const sql = getSql();
  const empty = typeof rawUrl === 'string' && rawUrl.trim() === '';
  if (empty || rawUrl == null) {
    await sql.run(
      'DELETE FROM property_brand_assets WHERE property_id = ? AND role = ? AND organization_id = ?',
      [propertyId, role, organizationId]);
    return 'removed';
  }

  const url = readBrandLogoUrl(rawUrl);
  if (!url) return 'bad-url';

  // `organization_id` названо ЯВНО (інваріант 12): на SQLite дефолту від
  // контексту немає, і рядок дістав би NULL-орендаря беззвучно — тобто
  // зображення, якого не бачить жоден готель.
  await sql.run(
    `INSERT INTO property_brand_assets (organization_id, property_id, role, url)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (property_id, role) DO UPDATE SET url = excluded.url, updated_at = CURRENT_TIMESTAMP`,
    [organizationId, propertyId, role, url]);
  return 'saved';
}
