/**
 * Скільки броней використовує канал продажу — питання перед його видаленням.
 *
 * ── Чому лічильник іде від САМОГО РЯДКА, а не від запиту ────────────────
 *
 * `booking_sources` належить БУДИНКУ, а `reservations.source` — це код-рядок
 * (`direct`, `booking_com`), не посилання. Тому два будинки одного рахунку
 * мають кожен свій рядок з тим самим кодом, і лічильник по всьому рахунку
 * рахував чужі броні: видалити «Прямі» будинку А було неможливо, поки будинок
 * Б мав хоч одну пряму бронь. Відмова без причини, яку оператор може усунути.
 *
 * Область тут береться не з адреси і не з куки, а з рядка, який видаляють, —
 * той самий довід, що для `INSERT` з підзапитом (інваріант 12): вона не може
 * розійтися з обʼєктом, від якого походить. Тому підпис бере `propertyId`, а
 * не `PropertyScope`: «усі обʼєкти» тут не буває — джерело завжди чиєсь.
 */
import { getSql } from '@core/db/async';

export async function sourceUsageCount(
  organizationId: string,
  propertyId: string,
  code: string,
): Promise<number> {
  const row = await getSql().row<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM reservations r
       JOIN properties p ON r.property_id = p.id
      WHERE r.source = ? AND p.organization_id = ? AND r.property_id = ?`,
    [code, organizationId, propertyId]);
  return Number(row?.cnt) || 0;
}
