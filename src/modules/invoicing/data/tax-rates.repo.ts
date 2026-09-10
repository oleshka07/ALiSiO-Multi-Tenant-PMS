import { getSql } from '@core/db/async';
import type { TaxRate } from '../domain/invoice-vat';

/**
 * Набір ставок ПДВ ДЛЯ ЦЬОГО БУДИНКУ — одні двері на всіх читачів (INC-038, Д54).
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `fin_tax_rates` не мала `property_id`, і кожен читач писав
 * `WHERE organization_id = ?`. Готель із будинком у Чехії і будинком у
 * Німеччині під одним рахунком діставав ОДНУ таблицю ставок, а ставка лягає на
 * нарахування ЧИСЛОМ (інваріант 18) — тобто в документ держави. Німецький
 * рахунок виходив із чеськими 21 % замість 19 %, без жодної помилки в лозі.
 *
 * Інваріант 8 (мовчазного дефолту не буває) та інваріант 22 (юрисдикція —
 * модуль) разом, і продукт заявлений під Європу І Україну, тож випадок не
 * гіпотетичний, а ринковий.
 *
 * ── Старшинство ─────────────────────────────────────────────────────────
 *
 *   1. набір БУДИНКУ, якщо він є, — і тоді він авторитетний ЦІЛКОМ;
 *   2. інакше спільний набір рахунку (`property_id IS NULL`), але **лише
 *      якщо він для цього будинку однозначний**;
 *   3. інакше — названа відмова, яка доїжджає до екрана словами.
 *
 * Пункт 1 навмисно не має «доберемо чого бракує зі спільного»: підмішати одну
 * ставку іншої юрисдикції в набір іншої — рівно та вада, від якої вся ця
 * правка, тільки записана дрібнішими літерами. Коду, якого немає у ВЛАСНОМУ
 * наборі, відмовляє звичайний `no_tax_rate` вище за течією.
 *
 * ── «Країна рахунку»: підміна, яку треба назвати ────────────────────────
 *
 * Д54 каже — спільний набір застосовується, тільки якщо країна будинку
 * збігається з країною РАХУНКУ. **Колонки країни в `organizations` не існує**:
 * там є `legal_address`, `vat_no`, `is_vat_payer`, але не `country`
 * (перевірено по схемі гілки робіт). Юрисдикцію в цьому коді визначає
 * `properties.country` — саме її читає `documentLanguage()`, і саме там
 * написано, що юрисдикція не належить готелю як конторі.
 *
 * Тому країна рахунку береться так, як цей код УЖЕ бере «власне рахунку», коли
 * факт лежить лише на будинках: `getOrgIdentity` читає телефон
 * `FROM properties … ORDER BY created_at LIMIT 1`. Країна рахунку — країна
 * НАЙСТАРШОГО будинку. Це наявний у сусідньому файлі взірець, а не вигадане
 * правило; підміна названа у звіті задачі 8, бо дослівне прочитання Д54
 * нездійсненне без нової колонки, яку нікому було б заповнювати.
 *
 * `ORDER BY created_at, id` — з другим ключем: рядків з однаковою міткою часу
 * буває більше одного, і «найстарший» не сміє залежати від порядку, який
 * SQLite і Postgres дають різний (INC-027).
 *
 * Будинок без країни спільний набір ПРИЙМАЄ: відсутня країна — це прогалина в
 * даних, а не юрисдикція, і саме так її трактує `documentLanguage`. Відмова
 * тут зупинила б готель, який просто не заповнив поле.
 */
export type TaxRatesFor =
  | { rates: TaxRate[] }
  /** Спільний набір належить іншій країні. Названо будинок і його країну —
   *  тільки так оператор знає, ЩО саме йому заводити. */
  | { reason: 'no_tax_rate_for_property'; property: string; country: string | null };

export async function taxRatesFor(
  organizationId: string,
  propertyId: string | null,
): Promise<TaxRatesFor> {
  const sql = getSql();

  // Фоліо без будинку (подія, рахунок компанії) країни не має й мати не може —
  // для нього спільний набір і є відповіддю, як було до цієї правки.
  if (!propertyId) {
    return { rates: await sharedRates(organizationId) };
  }

  const own = await sql.rows<TaxRate>(
    `SELECT code, rate, valid_from, valid_to FROM fin_tax_rates
      WHERE organization_id = ? AND property_id = ?`,
    [organizationId, propertyId]);
  if (own.length > 0) return { rates: own };

  const house = await sql.row<{ name: string; country: string | null }>(
    'SELECT name, country FROM properties WHERE id = ? AND organization_id = ?',
    [propertyId, organizationId]);
  const accountCountry = await sql.row<{ country: string | null }>(
    `SELECT country FROM properties WHERE organization_id = ?
      ORDER BY created_at, id LIMIT 1`,
    [organizationId]);

  const mine = (house?.country || '').toUpperCase();
  const theirs = (accountCountry?.country || '').toUpperCase();
  if (mine && theirs && mine !== theirs) {
    return {
      reason: 'no_tax_rate_for_property',
      property: house?.name || propertyId,
      country: house?.country ?? null,
    };
  }

  return { rates: await sharedRates(organizationId) };
}

async function sharedRates(organizationId: string): Promise<TaxRate[]> {
  return getSql().rows<TaxRate>(
    `SELECT code, rate, valid_from, valid_to FROM fin_tax_rates
      WHERE organization_id = ? AND property_id IS NULL`,
    [organizationId]);
}
