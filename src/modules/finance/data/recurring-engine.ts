/* eslint-disable @typescript-eslint/no-explicit-any */
import { createOperationInTx } from '../api/operations.handlers.ts';
import { getSql } from '@core/db/async';
import { todayFor } from '@core/hotel-day';
import { runWithOrganization } from '@core/auth/tenant-context';

export type Schedule = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Template {
  id: string;
  organization_id: string;
  name: string;
  op_type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency: string;
  account_from_id: string | null;
  account_to_id: string | null;
  category_id: string | null;
  project_id: string | null;
  counterparty_id: string | null;
  comment: string | null;
  schedule: Schedule;
  schedule_day: number | null;
  next_run_at: string;
  end_at: string | null;
  last_run_at: string | null;
  runs_created: number;
  is_active: number;
  /** Скільки прогонів поспіль відмовили і чим — видно в списку шаблонів (Р13.7). */
  failed_runs?: number;
  last_error?: string | null;
  last_error_at?: string | null;
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function daysInMonth(year: number, monthIdx: number): number {
  return new Date(year, monthIdx + 1, 0).getDate();
}

/**
 * Compute the next date after `current` according to schedule.
 * For monthly/yearly, preserve day-of-month where possible, clamping to
 * last day of shorter months (Jan 31 → Feb 28/29 → Mar 31).
 */
export function advanceSchedule(current: string, schedule: Schedule, scheduleDay: number | null | undefined): string {
  const m = current.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Invalid date: ${current}`);
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);

  if (schedule === 'daily') {
    const d = new Date(year, monthIdx, day + 1);
    return toISODate(d);
  }
  if (schedule === 'weekly') {
    const d = new Date(year, monthIdx, day + 7);
    return toISODate(d);
  }
  if (schedule === 'monthly') {
    const nextYear = monthIdx === 11 ? year + 1 : year;
    const nextMonth = (monthIdx + 1) % 12;
    const preservedDay = scheduleDay ?? day;
    const maxDay = daysInMonth(nextYear, nextMonth);
    return toISODate(new Date(nextYear, nextMonth, Math.min(preservedDay, maxDay)));
  }
  // yearly
  const nextYear = year + 1;
  const preservedDay = scheduleDay ?? day;
  const maxDay = daysInMonth(nextYear, monthIdx);
  return toISODate(new Date(nextYear, monthIdx, Math.min(preservedDay, maxDay)));
}

/**
 * Materialize (create) one occurrence of the template as a fin_operation.
 * Writes to DB, advances template.next_run_at.
 * Returns the created operation id.
 */
export async function materializeTemplate(template: Template, asOfDate: string): Promise<string> {
  const sql = getSql();
  const runDate = template.next_run_at;
  const today = asOfDate || new Date().toISOString().substring(0, 10);
  const isFuture = runDate > today;

  const operationId = await createOperationInTx(template.organization_id, {
    op_type: template.op_type,
    account_from_id: template.account_from_id,
    account_to_id: template.account_to_id,
    amount: template.amount,
    currency: template.currency,
    paid_at: runDate,
    accrued_at: runDate,
    category_id: template.op_type === 'transfer' ? null : template.category_id,
    project_id: template.project_id,
    counterparty_id: template.counterparty_id,
    comment: template.comment || `Регулярно: ${template.name}`,
    source: 'recurring',
    source_ref: template.id,
    status: isFuture ? 'pending' : 'completed',
    is_planned: isFuture ? 1 : 0,
  });

  const nextDate = advanceSchedule(runDate, template.schedule, template.schedule_day);
  const stopRun = template.end_at && nextDate > template.end_at;
  // `FALSE`, не `0`: колонка BOOLEAN, і `CASE WHEN ? THEN 0 ELSE is_active END`
  // на Postgres падає з «CASE types boolean and integer cannot be matched»
  // (інваріант 12). Ця гілка не спрацьовувала НІКОЛИ: до Р13.7 обхід не бачив
  // на Postgres жодного шаблону взагалі, тож один мовчазний дефект ховав
  // другий. Пояснення тут, а не коментарем SQL у шаблоні: зворотна лапка в
  // такому коментарі рве сам шаблон.
  await sql.run(`
    UPDATE fin_recurring_templates
    SET last_run_at = ?, next_run_at = ?, runs_created = runs_created + 1,
        is_active = CASE WHEN ? THEN FALSE ELSE is_active END,
        -- Успішний прогін скидає лічильник: рахуються відмови ПОСПІЛЬ, а не
        -- за все життя шаблону. Інакше три збої за півроку погасили б шаблон,
        -- який щомісяця працює.
        failed_runs = 0, last_error = NULL, last_error_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [runDate, nextDate, Boolean(stopRun), template.id]);

  return operationId;
}

/**
 * Скільки відмов поспіль шаблон переживає, перш ніж його вимкнути.
 *
 * Не одна (Р13.7). Доти рушій гасив шаблон із ПЕРШОГО винятку, і це було
 * подвійно погано: помилка конфігурації тихо вимикала готелю регулярний
 * платіж, а сама відмова лишалась у логу контейнера, який не читає ніхто.
 * Оренда просто переставала нараховуватись.
 *
 * Три, бо найчастіша відмова тут ТИМЧАСОВА: курс валюти на сьогодні ще не
 * заведено (`computeAmountCompany` відмовляє названо), і завтра той самий
 * шаблон пройде. Погашений шаблон сам не вмикається — його вмикають руками,
 * а щоб увімкнути, треба спершу помітити.
 */
const FAILURES_BEFORE_PAUSE = 3;

/**
 * Записати відмову так, щоб її побачив ГОТЕЛЬ, а не лог.
 *
 * `next_run_at` зсувається на наступний строк у будь-якому разі: без цього
 * шаблон лишається «до виконання», і цикл нижче вибирає його знову й знову до
 * стелі в 1000 обертів. Тобто пропущене нарахування — свідома ціна за те, щоб
 * рушій не зупинився на одному зламаному шаблоні; видно її в `failed_runs`.
 */
async function recordTemplateFailure(template: Template, error: any): Promise<void> {
  const sql = getSql();
  const failed = Number(template.failed_runs || 0) + 1;
  const nextDate = advanceSchedule(template.next_run_at, template.schedule, template.schedule_day);
  await sql.run(`
    UPDATE fin_recurring_templates
       SET failed_runs = ?, last_error = ?, last_error_at = CURRENT_TIMESTAMP,
           next_run_at = ?,
           is_active = CASE WHEN ? THEN FALSE ELSE is_active END,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND organization_id = ?
  `, [failed, String(error?.message || error).slice(0, 500), nextDate,
    failed >= FAILURES_BEFORE_PAUSE, template.id, template.organization_id]);
}

/**
 * Run all templates that are due (next_run_at <= lookahead).
 * Lookahead defaults to 30 days so planned operations show up in calendar early.
 * Returns count created.
 */
export async function runRecurringTick(lookaheadDays = 30): Promise<{ created: number; templates: number; errors: string[] }> {
  const sql = getSql();
  const today = new Date();
  const lookahead = new Date(today);
  lookahead.setDate(today.getDate() + lookaheadDays);
  const lookaheadIso = toISODate(lookahead);

  const errors: string[] = [];
  let created = 0;
  let templatesTouched = 0;

  // Обхід ПО ГОТЕЛЯХ, у контексті кожного (INC-014).
  //
  // Тут стояв один запит без орендаря. На SQLite він бачив усі шаблони, і все
  // працювало; на Postgres політика звіряє `organization_id` з налаштуванням,
  // якого ніхто не робив, — і запит не знаходив НІЧОГО. Прод на Postgres.
  // Тобто регулярні платежі не нараховувались узагалі, а «створено 0» виглядає
  // рівно так само, як спокійний день. Той самий клас, що вже описаний у
  // `cron/guest-reminders` — і та сама форма ліків.
  //
  // Знайдено 09.09.2026 прогоном `check:pg` роллю `alisio_app`: на SQLite цей
  // же гейт був зелений.
  const organizations = await sql.rows<{ id: string }>('SELECT id FROM organizations');

  for (const org of organizations) {
    // Відмова одного готелю не спиняє решти.
    try {
      const outcome = await runWithOrganization(org.id, async () => {
        let orgCreated = 0;
        let orgTouched = 0;
        // Keep looping until no due templates remain (safety cap 1000 iterations)
        for (let i = 0; i < 1000; i++) {
          const due = await sql.rows<any>(`
            SELECT * FROM fin_recurring_templates
            WHERE organization_id = ? AND is_active = TRUE AND next_run_at <= ?
              AND (end_at IS NULL OR next_run_at <= end_at)
            ORDER BY next_run_at ASC
            LIMIT 50
          `, [org.id, lookaheadIso]) as Template[];

          if (due.length === 0) break;

          for (const t of due) {
            try {
              // Each template belongs to a hotel, and «is this date in the future»
              // is a question about that hotel's calendar, not the server's: a
              // template due today would be written as `pending` for the first hours
              // of the local day if we asked UTC.
              await materializeTemplate(t, await todayFor(t.organization_id));
              orgCreated++;
            } catch (e: any) {
              errors.push(`${t.id} (${t.name}): ${e.message}`);
              await recordTemplateFailure(t, e);
            }
          }
          orgTouched += due.length;
        }
        return { orgCreated, orgTouched };
      });
      created += outcome.orgCreated;
      templatesTouched += outcome.orgTouched;
    } catch (e: any) {
      errors.push(`${org.id}: ${e.message}`);
    }
  }

  return { created, templates: templatesTouched, errors };
}

/**
 * Runs tick only if it hasn't been run in the last ~24 hours.
 * Uses fin_system_state to track last run.
 */
export async function runRecurringTickIfDue(): Promise<boolean> {
  const sql = getSql();
  const lastRow = await sql.row<any>("SELECT value FROM fin_system_state WHERE key = 'last_recurring_tick'") as { value: string } | undefined;
  const now = Date.now();
  if (lastRow?.value) {
    const last = new Date(lastRow.value).getTime();
    if (now - last < 23 * 60 * 60 * 1000) return false; // less than 23 hours
  }

  const result = await runRecurringTick();
  await sql.run(`
    INSERT INTO fin_system_state (key, value) VALUES ('last_recurring_tick', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `, [new Date().toISOString()]);

  if (result.created > 0 || result.errors.length > 0) {
    console.log(`[Recurring] Tick: created ${result.created} ops from ${result.templates} templates, ${result.errors.length} errors`);
    if (result.errors.length > 0) console.log('[Recurring] Errors:', result.errors);
  }
  return true;
}

/**
 * Forecast what operations WOULD be created by active templates in a date range,
 * without actually writing to DB. Used by calendar view to preview recurring instances.
 */
// ─────────────────────────────────────────────────────────────────
// PR #26: suggest a recurring template that an incoming bank op might be
//
// When the bank inbox creates a fin_operation, we scan active recurring
// templates for a likely match (same op_type, amount within tolerance,
// optional counterparty match, currency match). If exactly one good
// candidate exists, we tag the op with suggested_recurring_id so the UI
// can offer a one-click "yes, this is the rent" confirmation.
// ─────────────────────────────────────────────────────────────────

const AMOUNT_TOLERANCE_PCT = 0.05; // 5% — covers small rent-rate adjustments

export interface RecurringSuggestion {
  template_id: string;
  template_name: string;
  amount: number;
  category_id: string | null;
  project_id: string | null;
  counterparty_id: string | null;
  comment: string | null;
}

/**
 * Find at most one matching recurring template for an operation. Returns
 * null when no match or multiple ambiguous matches (we don't want to guess).
 *
 * Match criteria (must all hold):
 *   - same op_type (income/expense)
 *   - same currency
 *   - amount within ±5% of template
 *   - is_active = 1
 *
 * Bonus signals (all-else-equal, prefer matching):
 *   - same counterparty_id (if op has one)
 *   - schedule_day close to op date day-of-month (within ±5 days)
 */
export async function findRecurringSuggestion(
  orgId: string,
  op: { op_type: string; amount: number; currency: string; counterparty_id: string | null; paid_at: string },
): Promise<RecurringSuggestion | null> {
  const sql = getSql();
  const tolerance = op.amount * AMOUNT_TOLERANCE_PCT;
  const minAmt = op.amount - tolerance;
  const maxAmt = op.amount + tolerance;

  const candidates = await sql.rows<any>(`
    SELECT id, name, amount, category_id, project_id, counterparty_id, comment, schedule_day
    FROM fin_recurring_templates
    WHERE organization_id = ? AND is_active = TRUE
      AND op_type = ? AND currency = ?
      AND amount BETWEEN ? AND ?
  `, [orgId, op.op_type, op.currency, minAmt, maxAmt]) as any[];

  if (candidates.length === 0) return null;

  // If exactly one — that's the suggestion
  if (candidates.length === 1) {
    const t = candidates[0];
    return {
      template_id: t.id, template_name: t.name, amount: t.amount,
      category_id: t.category_id, project_id: t.project_id,
      counterparty_id: t.counterparty_id, comment: t.comment,
    };
  }

  // Multiple — score by closeness of (a) amount, (b) counterparty match,
  // (c) day-of-month. Take winner if it dominates clearly; else null.
  const opDay = Number((op.paid_at || '').substring(8, 10)) || 0;
  const scored = candidates.map((t: any) => {
    let score = 0;
    score += 100 - Math.abs(t.amount - op.amount) / op.amount * 100; // 0..100
    if (op.counterparty_id && t.counterparty_id === op.counterparty_id) score += 50;
    if (t.schedule_day && opDay && Math.abs(t.schedule_day - opDay) <= 5) score += 20;
    return { ...t, _score: score };
  }).sort((a: any, b: any) => b._score - a._score);

  // Winner must beat runner-up by 10+ points to avoid ambiguity
  if (scored[0]._score - scored[1]._score < 10) return null;

  const t = scored[0];
  return {
    template_id: t.id, template_name: t.name, amount: t.amount,
    category_id: t.category_id, project_id: t.project_id,
    counterparty_id: t.counterparty_id, comment: t.comment,
  };
}

/**
 * Convenience: find suggestion for an op + write suggested_recurring_id
 * onto the operation row in one shot. Used by bank-inbox-engine.
 */
export async function tagOpWithRecurringSuggestion(
  orgId: string,
  opId: string,
  op: { op_type: string; amount: number; currency: string; counterparty_id: string | null; paid_at: string },
): Promise<RecurringSuggestion | null> {
  const sql = getSql();
  const suggestion = await findRecurringSuggestion(orgId, op);
  if (suggestion) {
    await sql.run("UPDATE fin_operations SET suggested_recurring_id = ? WHERE id = ?", [suggestion.template_id, opId]);
  }
  return suggestion;
}

export interface ForecastOp {
  template_id: string;
  template_name: string;
  op_type: string;
  amount: number;
  currency: string;
  category_id: string | null;
  project_id: string | null;
  account_from_id: string | null;
  account_to_id: string | null;
  date: string;
}

export async function forecastUpcoming(orgId: string, fromDate: string, toDate: string): Promise<ForecastOp[]> {
  const sql = getSql();
  const templates = await sql.rows<any>(`
    SELECT * FROM fin_recurring_templates
    WHERE organization_id = ? AND is_active = TRUE
  `, [orgId]) as Template[];

  const result: ForecastOp[] = [];
  for (const t of templates) {
    let cursor = t.next_run_at;
    let safety = 400;
    while (cursor <= toDate && safety-- > 0) {
      if (cursor >= fromDate) {
        if (t.end_at && cursor > t.end_at) break;
        result.push({
          template_id: t.id,
          template_name: t.name,
          op_type: t.op_type,
          amount: t.amount,
          currency: t.currency,
          category_id: t.category_id,
          project_id: t.project_id,
          account_from_id: t.account_from_id,
          account_to_id: t.account_to_id,
          date: cursor,
        });
      }
      cursor = advanceSchedule(cursor, t.schedule, t.schedule_day);
      if (t.end_at && cursor > t.end_at) break;
    }
  }
  return result;
}
