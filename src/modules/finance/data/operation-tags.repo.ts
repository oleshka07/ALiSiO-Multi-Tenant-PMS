/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { refuse } from '@core/http/errors';
import { ownedFinanceRow } from './owned.repo';

/**
 * Мітки операції — одні двері на обидва входи і на всі читання (Р13.2).
 *
 * `tag_ids` — ШОСТЕ поле того самого тіла запиту, що й пʼять полів
 * `CATALOGUE_REFERENCES`, і воно жило повз їхню варту: створення
 * (`operations.handlers.ts`) і редагування клали клієнтські id прямо в
 * `fin_operation_tags`, а три читачі джойнили `finance_tags` без орендаря.
 *
 * Чому окремий файл, а не ще пʼять рядків у хендлері. `fin_operation_tags` —
 * чиста звʼязка, БЕЗ `organization_id`: орендар у ній читається лише через
 * `finance_tags`. Тобто кожне звертання до звʼязки мусить памʼятати про
 * джойн, і забути про нього можна в кожному з шести місць окремо — саме так
 * і вийшло. Одні двері памʼятають за всіх.
 *
 * Чому це червоне саме на SQLite. На Postgres запис ловить `WITH CHECK`
 * політики `finance_tags`, а читання ховає та сама політика. На SQLite
 * політик немає — і чуже імʼя мітки просто повертається в API. Рід INC-014:
 * зелено там, де політика є, червоно там, де її немає. Уся розробка і майже
 * весь гейт-парк — це SQLite.
 */

/**
 * Мітки належать цьому готелю, або названа відмова 404 (інваріант 5).
 * Повертає той самий список без повторів — саме він і йде в запис.
 */
export async function requireOwnedTags(
  organizationId: string,
  tagIds: readonly unknown[],
): Promise<string[]> {
  const ids = [...new Set(tagIds.map((t) => String(t)).filter(Boolean))];
  for (const id of ids) {
    if (!await ownedFinanceRow('finance_tags', id, organizationId)) {
      refuse('Мітки з таким ідентифікатором у цього готелю немає.', 404);
    }
  }
  return ids;
}

/** Замінити мітки операції на названі. Належність доводиться ДО запису. */
export async function setOperationTags(
  organizationId: string,
  operationId: string,
  tagIds: readonly unknown[],
): Promise<void> {
  const sql = getSql();
  const ids = await requireOwnedTags(organizationId, tagIds);
  // Знімаються ЛИШЕ свої: чужа звʼязка, яка вже лежить у базі, не належить
  // цьому готелю, і мовчки прибирати чужий рядок — це та сама дія навпаки.
  // Вона лишається невидимою для нього (читачі нижче) і чекає на розбір.
  await sql.run(`
    DELETE FROM fin_operation_tags
     WHERE operation_id = ?
       AND tag_id IN (SELECT id FROM finance_tags WHERE organization_id = ?)
  `, [operationId, organizationId]);
  await addOperationTags(organizationId, operationId, ids);
}

/** Додати мітки, не чіпаючи наявних (шлях авто-правил). */
export async function addOperationTags(
  organizationId: string,
  operationId: string,
  tagIds: readonly unknown[],
): Promise<void> {
  const sql = getSql();
  const ids = await requireOwnedTags(organizationId, tagIds);
  for (const tagId of ids) {
    await sql.run(
      'INSERT INTO fin_operation_tags (operation_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      [operationId, tagId]);
  }
}

/** Назви міток однієї операції — лише мітки цього готелю. */
export async function tagNamesFor(
  organizationId: string,
  operationId: string,
): Promise<string[]> {
  const sql = getSql();
  const rows = await sql.rows<any>(`
    SELECT t.name FROM fin_operation_tags ot
    JOIN finance_tags t ON t.id = ot.tag_id AND t.organization_id = ?
    WHERE ot.operation_id = ?
    ORDER BY t.sort_order, t.name
  `, [organizationId, operationId]) as { name: string }[];
  return rows.map((r) => r.name);
}

/** Те саме для багатьох операцій — один запит на 500 ідентифікаторів. */
export async function tagNamesForBatch(
  organizationId: string,
  operationIds: readonly string[],
): Promise<Record<string, string[]>> {
  const sql = getSql();
  if (operationIds.length === 0) return {};
  const map: Record<string, string[]> = {};
  for (let i = 0; i < operationIds.length; i += 500) {
    const chunk = operationIds.slice(i, i + 500);
    const ph = chunk.map(() => '?').join(',');
    const rows = await sql.rows<any>(`
      SELECT ot.operation_id, t.name FROM fin_operation_tags ot
      JOIN finance_tags t ON t.id = ot.tag_id AND t.organization_id = ?
      WHERE ot.operation_id IN (${ph})
      ORDER BY t.sort_order, t.name
    `, [organizationId, ...chunk]) as { operation_id: string; name: string }[];
    for (const r of rows) {
      if (!map[r.operation_id]) map[r.operation_id] = [];
      map[r.operation_id].push(r.name);
    }
  }
  return map;
}

/**
 * Ідентифікатори міток операції — лише свої.
 *
 * Читається перед копіюванням операції. Без орендаря копія тягла б за собою
 * чужу звʼязку — тобто читання перетворювалось би на ЗАПИС чужого id у новий
 * рядок. Чужа мітка для цього готелю не існує, тож у копію вона не потрапляє.
 */
export async function tagIdsFor(
  organizationId: string,
  operationId: string,
): Promise<string[]> {
  const sql = getSql();
  const rows = await sql.rows<any>(`
    SELECT ot.tag_id FROM fin_operation_tags ot
    JOIN finance_tags t ON t.id = ot.tag_id AND t.organization_id = ?
    WHERE ot.operation_id = ?
  `, [organizationId, operationId]) as { tag_id: string }[];
  return rows.map((r) => r.tag_id);
}
