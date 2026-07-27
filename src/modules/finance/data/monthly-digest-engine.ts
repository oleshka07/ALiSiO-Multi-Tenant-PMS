/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Monthly investor digest aggregator.
//
// Given a year_month (YYYY-MM) and optionally an investor_id, computes
// the per-investor month-end snapshot used by the admin "Monthly digest"
// tab to send/copy a per-investor report:
//
//   - For each investor's active investments, looks up the month's
//     property metrics (occupancy, revenue), computes profit attribution
//     by equity_pct, sums payouts paid in this calendar month, and
//     reports per-property + investor totals.
//   - Cumulative-to-date stats include all metric months from
//     invested_at through the chosen month.
//

export interface MonthlyDigestProperty {
  project_id: string;
  project_name: string;
  equity_pct: number | null;
  occupancy_pct: number | null;
  revenue: number;
  monthly_profit: number;          // revenue × equity%
  paid_this_month: number;
  accumulated_profit: number;      // cumulative since invested_at
  total_paid_to_date: number;
  pending_to_date: number;         // accumulated_profit − total_paid_to_date
}

export interface MonthlyDigestInvestor {
  investor_id: string;
  investor_name: string;
  email: string | null;
  telegram_chat_id: string | null;
  portal_token: string;
  currency: string;
  active_lots: number;
  totals: {
    monthly_revenue: number;
    monthly_profit: number;
    paid_this_month: number;
    accumulated_profit: number;
    total_paid_to_date: number;
    pending_to_date: number;
  };
  properties: MonthlyDigestProperty[];
  has_any_metric: boolean;         // false → tag UI as "no data for this month"
}

export interface MonthlyDigestResult {
  year_month: string;
  investors: MonthlyDigestInvestor[];
}

export function buildMonthlyDigest(
  db: any,
  orgId: string,
  yearMonth: string,
  investorId?: string,
): MonthlyDigestResult {
  const investorWhere: string[] = ['organization_id = ?', "status = 'active'"];
  const params: any[] = [orgId];
  if (investorId) { investorWhere.push('id = ?'); params.push(investorId); }
  const investors = db.prepare(`
    SELECT id, name, email, telegram_chat_id, portal_token
    FROM investors
    WHERE ${investorWhere.join(' AND ')}
    ORDER BY name
  `).all(...params) as any[];

  const out: MonthlyDigestInvestor[] = [];

  for (const inv of investors) {
    const investments = db.prepare(`
      SELECT ii.*, bu.name AS project_name
      FROM investor_investments ii
      JOIN business_units bu ON bu.id = ii.project_id
      WHERE ii.investor_id = ? AND ii.is_active = 1
      ORDER BY ii.invested_at
    `).all(inv.id) as any[];

    if (investments.length === 0) continue;

    const currency = investments[0].currency || 'EUR';
    const properties: MonthlyDigestProperty[] = [];

    let totMonthlyRev = 0;
    let totMonthlyProfit = 0;
    let totPaidThisMonth = 0;
    let totAccProfit = 0;
    let totPaidToDate = 0;
    let hasAnyMetric = false;

    for (const ii of investments) {
      const eq = (ii.equity_pct || 0) / 100;

      // Metric for the chosen month
      const monthMetric = db.prepare(`
        SELECT occupancy_pct, revenue
        FROM property_monthly_metrics
        WHERE project_id = ? AND year_month = ?
      `).get(ii.project_id, yearMonth) as { occupancy_pct: number | null; revenue: number | null } | undefined;

      // All metrics from invested_at through chosen month (for accumulated)
      const cumMetrics = db.prepare(`
        SELECT revenue
        FROM property_monthly_metrics
        WHERE project_id = ? AND year_month >= ? AND year_month <= ?
      `).all(ii.project_id, ii.invested_at.substring(0, 7), yearMonth) as { revenue: number | null }[];
      const accProfit = cumMetrics.reduce((s, m) => s + ((m.revenue || 0) * eq), 0);

      // All payouts to this investor for this property
      const payouts = db.prepare(`
        SELECT amount, paid_at
        FROM investor_payouts
        WHERE investor_id = ? AND (project_id = ? OR project_id IS NULL)
      `).all(inv.id, ii.project_id) as { amount: number; paid_at: string }[];
      const totalPaidForProperty = payouts.reduce((s, p) => s + (p.amount || 0), 0);
      const paidThisMonth = payouts
        .filter((p) => p.paid_at && p.paid_at.substring(0, 7) === yearMonth)
        .reduce((s, p) => s + (p.amount || 0), 0);

      const revenue = monthMetric?.revenue || 0;
      const monthlyProfit = revenue * eq;
      if (monthMetric) hasAnyMetric = true;

      properties.push({
        project_id: ii.project_id,
        project_name: ii.project_name,
        equity_pct: ii.equity_pct,
        occupancy_pct: monthMetric?.occupancy_pct ?? null,
        revenue,
        monthly_profit: +monthlyProfit.toFixed(2),
        paid_this_month: +paidThisMonth.toFixed(2),
        accumulated_profit: +accProfit.toFixed(2),
        total_paid_to_date: +totalPaidForProperty.toFixed(2),
        pending_to_date: +(accProfit - totalPaidForProperty).toFixed(2),
      });

      totMonthlyRev += revenue;
      totMonthlyProfit += monthlyProfit;
      totPaidThisMonth += paidThisMonth;
      totAccProfit += accProfit;
      totPaidToDate += totalPaidForProperty;
    }

    out.push({
      investor_id: inv.id,
      investor_name: inv.name,
      email: inv.email,
      telegram_chat_id: inv.telegram_chat_id,
      portal_token: inv.portal_token,
      currency,
      active_lots: investments.length,
      totals: {
        monthly_revenue: +totMonthlyRev.toFixed(2),
        monthly_profit: +totMonthlyProfit.toFixed(2),
        paid_this_month: +totPaidThisMonth.toFixed(2),
        accumulated_profit: +totAccProfit.toFixed(2),
        total_paid_to_date: +totPaidToDate.toFixed(2),
        pending_to_date: +(totAccProfit - totPaidToDate).toFixed(2),
      },
      properties,
      has_any_metric: hasAnyMetric,
    });
  }

  return { year_month: yearMonth, investors: out };
}

/**
 * Render a plain-text digest suitable for pasting into Telegram, email,
 * or a chat message. Localised in Ukrainian.
 */
export function renderDigestText(d: MonthlyDigestInvestor, yearMonth: string, originUrl: string): string {
  const lines: string[] = [];
  lines.push(`📊 Звіт інвестору · ${yearMonth}`);
  lines.push(`Шановний/а ${d.investor_name},`);
  lines.push('');
  lines.push(`За ${yearMonth} ваш портфель показав такі результати:`);
  lines.push('');
  for (const p of d.properties) {
    lines.push(`🏠 ${p.project_name}${p.equity_pct ? ` (частка ${p.equity_pct}%)` : ''}`);
    if (p.revenue > 0 || p.occupancy_pct != null) {
      lines.push(`   • Виручка: ${fmt(p.revenue, d.currency)}${p.occupancy_pct != null ? `  • Завантаження: ${p.occupancy_pct}%` : ''}`);
      lines.push(`   • Ваш прибуток за місяць: ${fmt(p.monthly_profit, d.currency)}`);
    } else {
      lines.push(`   • Метрик за цей місяць ще немає`);
    }
    if (p.paid_this_month > 0) {
      lines.push(`   • Виплачено цього місяця: ${fmt(p.paid_this_month, d.currency)}`);
    }
  }
  lines.push('');
  lines.push(`💼 Підсумки:`);
  lines.push(`   • Прибуток за місяць: ${fmt(d.totals.monthly_profit, d.currency)}`);
  if (d.totals.paid_this_month > 0) {
    lines.push(`   • Виплачено цього місяця: ${fmt(d.totals.paid_this_month, d.currency)}`);
  }
  lines.push(`   • До виплати (накопичено): ${fmt(d.totals.pending_to_date, d.currency)}`);
  lines.push('');
  lines.push(`🔗 Ваш портал з повною статистикою:`);
  lines.push(`${originUrl}/invest/${d.portal_token}`);
  return lines.join('\n');
}

function fmt(n: number, cur: string): string {
  return `${n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}
