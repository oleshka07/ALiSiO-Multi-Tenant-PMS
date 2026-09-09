/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { AXIS_BY_STD_GROUP } from '@core/chart-of-accounts';
import { refuse } from '@core/http/errors';
// ════════════════════════════════════════════════════════════
// Canonical month money metrics — SINGLE DEFINITION of revenue/expenses
// for every cash-based report (overview, indicators, P&L, cashflow).
//
// Rules (cash basis, company currency CZK):
//   - only fin_operations with status='completed', op_type != 'transfer'
//   - REVENUE  = income excluding financing-classified categories,
//                minus refunds (expense ops with payment_subtype='refund')
//   - financing inflows (investor contributions, loans) are NOT revenue —
//     reported separately as financing_in
//   - EXPENSE buckets follow the category classifier, with std_group as
//     fallback for legacy rows; uncategorized spending is NEVER dropped —
//     it lands in the 'uncategorized' bucket
//   - CAPEX and financing outflows are separate buckets (not operating)
// ════════════════════════════════════════════════════════════

export interface MonthMoney {
  month: string;
  /** income (non-financing) minus refunds */
  revenue: number;
  /** gross income before netting refunds (non-financing) */
  gross_income: number;
  refunds: number;
  /** financing inflows: investor contributions, loans received */
  financing_in: number;
  /** operating expenses = cogs + variable + operational + other + uncategorized */
  expenses_operating: number;
  cogs: number;
  variable: number;
  operational: number;
  tax: number;
  other_expense: number;
  uncategorized_expense: number;
  capex_out: number;
  financing_out: number;
  /** revenue − expenses_operating (before tax) */
  ebitda: number;
}

/**
 * Вісь рядка звіту: `classifier`, а якщо його немає — `std_group`.
 *
 * Один вираз на ВСІ читання (Р13.4). Тут він був правильний, а
 * `reports.handlers.ts` поруч брав `COALESCE(ec.classifier, 'other')` — тобто
 * ліки були написані й не застосовані, і будь-який рядок із порожньою віссю
 * тихо йшов у «Інше». Жоден гейт цього не бачив, бо після Р12.1 усі фікстури
 * сіються з осями.
 *
 * `WHEN`-и будуються з `AXIS_BY_STD_GROUP` — тієї самої мапи, за якою вісь
 * ставить засів і форма нової статті. Список у трьох місцях розходився двічі
 * (`Financing` був то `expense`, то `income`, то ніде), тож він тут один.
 *
 * `ELSE 'unknown:' || std_group` — навмисно НЕ «other». «Не знаю, куди це» і
 * «це інше» — різні твердження (інваріант 13), і читач звіту мусить уміти
 * назвати перше. `other_expense` лишається для статей, чий `classifier`
 * СПРАВДІ `other` (рядок `transfer` плану рахунків).
 */
const CASE_BY_GROUP = Object.entries(AXIS_BY_STD_GROUP)
  .map(([group, axis]) => `WHEN '${group}' THEN '${axis.classifier}'`)
  .join('\n      ');

export const CLS_SQL = `
  LOWER(COALESCE(
    NULLIF(TRIM(COALESCE(ec.classifier, '')), ''),
    CASE TRIM(COALESCE(ec.std_group, ''))
      ${CASE_BY_GROUP}
      WHEN '' THEN 'uncategorized'
      ELSE 'unknown:' || ec.std_group
    END,
    'uncategorized'
  ))
`;

/**
 * Вісь, якої читач не знає, НАЗИВАЄТЬСЯ — одні двері на всі звіти (Р14.1).
 *
 * Це саме твердження стояло всередині `getPnlMatrix` і тільки там, тож
 * сусідні читачі — «PNL-2» і кешфлоу — тонули в мовчазному дефолті далі.
 * Виявилось, що «один читач на обидва місця» було виконано в одному місці з
 * чотирьох: вираз осі можна скопіювати, а разом із ним копіюється й обовʼязок
 * назвати те, чого він не знає.
 *
 * `rows` — те, що повернув запит із `CLS_SQL`; `classifier` у них ніколи не
 * порожній, але може бути `unknown:<група>`. Порожній список — нічого не
 * робимо: відмова тут не про відсутність даних, а про невідому вісь.
 */
export function refuseUnknownAxis(
  rows: readonly { classifier?: string | null; cat_name?: string | null;
    cat_code?: string | null; cat_id?: string | null; cat_std_group?: string | null }[],
  where: string,
): void {
  const unknown = rows.filter((r) => String(r.classifier || '').startsWith('unknown:'));
  if (unknown.length === 0) return;
  const names = [...new Set(unknown.map((r) =>
    `«${r.cat_name ?? '—'}» (${r.cat_code || r.cat_id || '—'}, група «${r.cat_std_group ?? '—'}»)`))];
  refuse(`${where} не побудовано: у ${names.length === 1 ? 'статті' : 'статей'} ${names.join(', ')} `
    + 'група обліку не належить до відомих. Виправте групу в Фінанси → Налаштування → Статті обліку — '
    + 'інакше ці гроші стали б рядком «Інше», і знайти їх було б нічим.');
}

/**
 * Every number the finance overview shows for a month.
 *
 * The organization is a REQUIRED argument, not an option: this is the helper
 * behind revenue, expenses and EBITDA, and without it those were sums across
 * every company on the server. One hotel's overview quietly included another
 * hotel's income — the kind of wrong that looks like a plausible number.
 */
export async function getMonthMoney(organizationId: string, month: string): Promise<MonthMoney> {
  const sql = getSql();
  const rows = await sql.rows<any>(`
    SELECT o.op_type,
           CASE WHEN o.op_type = 'expense' AND COALESCE(o.payment_subtype, '') = 'refund'
                THEN 1 ELSE 0 END AS is_refund,
           CASE WHEN o.category_id IS NULL THEN 'uncategorized' ELSE ${CLS_SQL} END AS cls,
           COALESCE(SUM(o.amount_company), 0) AS total
    FROM fin_operations o
    LEFT JOIN expense_categories ec ON ec.id = o.category_id
    WHERE o.organization_id = ?
      AND o.status = 'completed'
      AND o.op_type != 'transfer'
      AND ${sql.dialect.month('o.paid_at')} = ?
    GROUP BY o.op_type, is_refund, cls
  `, [organizationId, month]) as { op_type: string; is_refund: number; cls: string; total: number }[];

  const m: MonthMoney = {
    month,
    revenue: 0, gross_income: 0, refunds: 0, financing_in: 0,
    expenses_operating: 0, cogs: 0, variable: 0, operational: 0,
    tax: 0, other_expense: 0, uncategorized_expense: 0,
    capex_out: 0, financing_out: 0, ebitda: 0,
  };

  for (const r of rows) {
    if (r.op_type === 'income') {
      if (r.cls === 'financing') m.financing_in += r.total;
      else m.gross_income += r.total;
      continue;
    }
    // expense
    if (r.is_refund) { m.refunds += r.total; continue; }
    switch (r.cls) {
      case 'cogs':          m.cogs += r.total; break;
      case 'variable':      m.variable += r.total; break;
      case 'operational':   m.operational += r.total; break;
      case 'tax':           m.tax += r.total; break;
      case 'capex':         m.capex_out += r.total; break;
      case 'financing':     m.financing_out += r.total; break;
      case 'uncategorized': m.uncategorized_expense += r.total; break;
      // Невідома група (`unknown:…`) сюди теж: гроші НЕ зникають, і рядок
      // видно як некласифікований, а не як «Інше». Назвати статтю поіменно —
      // робота звіту (`getPnlMatrix`), не місячних підсумків.
      default:
        if (String(r.cls).startsWith('unknown:')) m.uncategorized_expense += r.total;
        else m.other_expense += r.total;
        break;
    }
  }

  m.revenue = m.gross_income - m.refunds;
  m.expenses_operating = m.cogs + m.variable + m.operational + m.other_expense + m.uncategorized_expense;
  m.ebitda = m.revenue - m.expenses_operating;
  return m;
}
