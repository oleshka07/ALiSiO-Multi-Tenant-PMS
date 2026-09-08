/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { expectedAxis, axisIsWrong } from '@core/chart-of-accounts';

/**
 * Лікування осей плану рахунків для баз, які вже існують (Р13.6).
 *
 * Р12.1 підписував осі там, де ПОРОЖНЬО — і саме тому лишав без лікування ті
 * бази, яким гірше за всіх. Одноразовий легасі-бекфіл `db.ts` ставить осі
 * НЕПОРОЖНІ й неправильні:
 *
 *   - `std_group = 'Financing'` не потрапляє в жоден його `WHEN`, тож стаття
 *     падає в останній рядок (`op_type IS NULL → other/other`). `investors` —
 *     надходження від інвестора — дістає вісь «інше», і в P&L ці гроші йдуть
 *     нижче EBITDA зі знаком мінус;
 *   - `Revenue → classifier 'other'` — прямо, першим же рядком.
 *
 * Після нього другий бекфіл, який лікує порожнє, не спрацьовує вже НІКОЛИ:
 * його умова `op_type IS NULL OR op_type = ''` не виконується. А `--list`
 * показує «без осей: 0» — не «є проблема, якої не видно», а «проблеми немає».
 *
 * Тому міра тут — не порожнеча, а РОЗБІЖНІСТЬ із правилом: `expectedAxis`
 * за `code`, і лише для рядків без коду — за `std_group`. Порядок важливий:
 * два рядки плану навмисно відхиляються від своєї групи (`variable` — COGS,
 * але «Змінні»; `investors` — Financing, але надходження), і лікування самою
 * лише групою зламало б обидва.
 *
 * Чого воно свідомо НЕ робить: не чіпає статей, чиєї групи не знає ні план, ні
 * `AXIS_BY_STD_GROUP`. Вгадана вісь — це гроші в чужому рядку звіту; таку
 * статтю називає читач П&L названою відмовою (`pnl-classifier.check`), а не
 * лікує сівач.
 *
 * Ціна, названа вголос: вісь, яку готель змінив під себе через
 * `PATCH /api/finance/categories`, теж повернеться до правила. Обрано свідомо
 * (рішення контролера, Р13.6): неправильна вісь — це гроші не в тому рядку
 * звіту щомісяця, а свідома зміна осі рідкісна й повторюється за пів хвилини.
 * `wrongAxisRows` існує саме для того, щоб подивитись список ДО лікування.
 */

export interface AxisRow {
  id: string;
  code: string | null;
  name: string;
  std_group: string | null;
  op_type: string | null;
  classifier: string | null;
}

/** Рядки, чия вісь розходиться з правилом. Читає В КОНТЕКСТІ ОРЕНДАРЯ. */
export async function wrongAxisRows(organizationId: string): Promise<AxisRow[]> {
  const sql = getSql();
  const rows = await sql.rows<any>(
    'SELECT id, code, name, std_group, op_type, classifier FROM expense_categories WHERE organization_id = ?',
    [organizationId]) as AxisRow[];
  return rows.filter((r) => axisIsWrong(r));
}

/**
 * Статті, для яких правила немає взагалі — їх не лікують, про них кажуть.
 * Окремо від `wrongAxisRows` навмисно: «не знаю» і «знаю, що не так» — різні
 * твердження, і змішати їх означало б або вгадати вісь, або мовчки лишити.
 */
export async function unknownGroupRows(organizationId: string): Promise<AxisRow[]> {
  const sql = getSql();
  const rows = await sql.rows<any>(
    'SELECT id, code, name, std_group, op_type, classifier FROM expense_categories WHERE organization_id = ?',
    [organizationId]) as AxisRow[];
  return rows.filter((r) => expectedAxis(r.code, r.std_group) === null);
}

/** Привести осі до правила. Повертає, скільки рядків змінилось. Ідемпотентно. */
export async function repairAxes(organizationId: string): Promise<number> {
  const sql = getSql();
  let touched = 0;
  for (const row of await wrongAxisRows(organizationId)) {
    const want = expectedAxis(row.code, row.std_group);
    if (!want) continue;
    // За `id`, не за `code`: рядок без коду теж лікується, а два рядки з
    // однаковим кодом у різних готелів — це норма (INC-025), тож умова за
    // самим лише кодом зачепила б не той.
    await sql.run(
      'UPDATE expense_categories SET op_type = ?, classifier = ? WHERE id = ? AND organization_id = ?',
      [want.opType, want.classifier, row.id, organizationId]);
    touched += 1;
  }
  return touched;
}
