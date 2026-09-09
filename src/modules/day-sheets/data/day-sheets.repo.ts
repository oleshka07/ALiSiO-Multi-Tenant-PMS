/**
 * The four sheets reception prints every morning.
 *
 * At the pilot these are written by hand on a paper form and photocopied. Each
 * one answers a question somebody asks before 09:00:
 *
 *   Zimmerliste      who is in the house tonight, and in which room
 *   Frühstücksliste  how many people the kitchen cooks for tomorrow
 *   Schlüsselliste   which keys go out today and which come back
 *   Tagesabschluss   what was invoiced today, split by VAT rate
 *
 * All four are READ-ONLY and derived. Nothing here writes, and nothing here
 * stores a "sheet": a sheet printed yesterday is yesterday's answer, and a
 * table of them would be a second copy of data that already exists, drifting
 * from the first.
 *
 * The dates are the fiddly part and are stated once here rather than in four
 * queries:
 *
 *   in the house on D    check_in <= D  AND check_out >  D
 *   breakfast on morning D  check_in <  D  AND check_out >= D
 *
 * The second is not the first shifted by a day. Breakfast on the morning of D
 * is eaten by whoever slept the night that ENDS on D — so a guest who checks
 * out on D still eats, and a guest who checks in on D does not.
 *
 * KNOWN LIMIT — the day close and midnight. `issued_at` is a moment, and which
 * DAY that moment belongs to depends on the time zone the comparison runs in.
 * On Postgres `(issued_at)::date` uses the session zone, which is the server's
 * and not the hotel's. An invoice issued at 01:00 Berlin time lands on the
 * previous day if the server thinks in UTC. Left as is deliberately: fixing it
 * properly means carrying the property's zone into the query, and it only
 * shows up on documents issued in the hour after midnight — rare at a
 * reception desk, and visibly wrong when it happens rather than silently off.
 * Whoever needs it exact should start here.
 */
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { propertyScopeFilter, type PropertyScope } from '@core/property-scope';

/** Statuses that mean a person is actually coming or has come. */
const LIVE = "('confirmed', 'tentative', 'checked_in', 'checked_out')";

export interface StayRow {
  reservation_id: string;
  unit_code: string | null;
  unit_name: string | null;
  category: string | null;
  guest_name: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  nights: number;
  notes: string | null;
  status: string;
}

export interface BreakfastRow extends StayRow {
  /** How many people the kitchen cooks for. */
  persons: number;
  /** Whether the rate already contains breakfast, or it was ordered separately. */
  included: boolean;
  ordered: number;
}

export interface KeyRow extends StayRow {
  direction: 'in' | 'out';
}

export interface DayCloseRow {
  invoice_number: string;
  series: string | null;
  status: string;
  gross: number;
  by_rate: { vat_rate: number; gross: number; net: number; tax: number }[];
}

/**
 * Everyone in the house on this date — В ОДНОМУ будинку (INC-029).
 *
 * Аркуш друкують на початку зміни, і зміна належить будинку: до правки він
 * зводив в один папір гостей обох обʼєктів рахунку.
 */
export async function houseList(date: string, scope: PropertyScope): Promise<StayRow[]> {
  const organizationId = await requireOrganizationId();
  const inScope = propertyScopeFilter(scope, 'r');
  const rows = await getSql().rows<any>(
    `SELECT r.id AS reservation_id, u.code AS unit_code, u.name AS unit_name,
            c.name AS category,
            g.first_name, g.last_name,
            r.check_in, r.check_out, r.adults, r.children, r.nights,
            r.notes, r.status
       FROM reservations r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN categories c ON c.id = u.category_id
       LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.organization_id = ? AND ${inScope.sql}
        AND r.status IN ${LIVE}
        AND r.check_in <= ? AND r.check_out > ?
      ORDER BY u.code, u.name`,
    [organizationId, ...inScope.params, date, date],
  );
  return rows.map(toStay);
}

/**
 * Who eats breakfast on the morning of this date.
 *
 * `included` is answered from the channel rule that governs the booking's
 * source — the same rule that splits the money (finance/domain/
 * channel-rate-rule.ts). A rate that contains breakfast means the kitchen
 * cooks whether or not anybody ordered anything.
 *
 * `ordered` counts breakfast bought as a service on top. Both are shown,
 * because the kitchen needs the headcount and reception needs to know why.
 */
export async function breakfastList(date: string, scope: PropertyScope): Promise<BreakfastRow[]> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const inScope = propertyScopeFilter(scope, 'r');

  const rows = await sql.rows<any>(
    `SELECT r.id AS reservation_id, u.code AS unit_code, u.name AS unit_name,
            c.name AS category,
            g.first_name, g.last_name,
            r.check_in, r.check_out, r.adults, r.children, r.nights,
            r.notes, r.status, r.source
       FROM reservations r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN categories c ON c.id = u.category_id
       LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.organization_id = ? AND ${inScope.sql}
        AND r.status IN ${LIVE}
        AND r.check_in < ? AND r.check_out >= ?
      ORDER BY u.code, u.name`,
    [organizationId, ...inScope.params, date, date],
  );
  if (rows.length === 0) return [];

  // Правила каналу лишаються по РАХУНКУ свідомо, і це не пропуск осі.
  // `channel_rate_rules.property_id` — NULLABLE, і NULL там означає «правило
  // всього рахунку»: додати сюди фільтр обʼєкта — це тихо втратити саме ті
  // рядки, на яких тримається дефолт (той самий звір, що рядок без орендаря,
  // інваріант 12). Що означає NULL у цій таблиці — питання власника таблиці
  // (сесія 2, `modules/channels`), а не аркуша дня; до відповіді правило
  // читається як загальне, і саме так воно й задумане.
  const rules = await sql.rows<any>(
    'SELECT channel, includes_breakfast FROM channel_rate_rules WHERE organization_id = ?',
    [organizationId],
  );
  const includesFor = (source: string | null): boolean => {
    const wanted = String(source ?? '').trim().toLowerCase();
    const exact = rules.find((r) => String(r.channel ?? '').trim().toLowerCase() === wanted && r.channel);
    const rule = exact ?? rules.find((r) => !r.channel);
    return !!rule && (rule.includes_breakfast === true || Number(rule.includes_breakfast) === 1);
  };

  // Breakfast bought as a service, for this morning. Counted per reservation
  // rather than joined into the query above: a stay may have several orders,
  // and a join would multiply the rows and the headcount with them.
  const ordered = new Map<string, number>();
  const onService = propertyScopeFilter(scope, 's');
  const orders = await sql.rows<any>(
    `SELECT o.reservation_id, SUM(o.quantity) AS qty
       FROM booking_service_orders o
       JOIN additional_services s ON s.id = o.service_id
      WHERE o.status <> 'cancelled'
        AND o.service_date = ?
        AND ${onService.sql}
        AND s.property_id IN (SELECT id FROM properties WHERE organization_id = ?)
      GROUP BY o.reservation_id`,
    [date, ...onService.params, organizationId],
  );
  for (const o of orders) ordered.set(String(o.reservation_id), Number(o.qty) || 0);

  return rows.map((r) => {
    const stay = toStay(r);
    return {
      ...stay,
      persons: stay.adults + stay.children,
      included: includesFor(r.source),
      ordered: ordered.get(stay.reservation_id) ?? 0,
    };
  });
}

/** Keys out (arrivals) and keys in (departures) on this date — В ОДНОМУ будинку. */
export async function keyList(date: string, scope: PropertyScope): Promise<KeyRow[]> {
  const organizationId = await requireOrganizationId();
  const inScope = propertyScopeFilter(scope, 'r');
  const rows = await getSql().rows<any>(
    `SELECT r.id AS reservation_id, u.code AS unit_code, u.name AS unit_name,
            c.name AS category,
            g.first_name, g.last_name,
            r.check_in, r.check_out, r.adults, r.children, r.nights,
            r.notes, r.status,
            CASE WHEN r.check_in = ? THEN 'out' ELSE 'in' END AS direction
       FROM reservations r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN categories c ON c.id = u.category_id
       LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.organization_id = ? AND ${inScope.sql}
        AND r.status IN ${LIVE}
        AND (r.check_in = ? OR r.check_out = ?)
      ORDER BY direction DESC, u.code, u.name`,
    [date, organizationId, ...inScope.params, date, date],
  );
  return rows.map((r) => ({ ...toStay(r), direction: r.direction as 'in' | 'out' }));
}

/**
 * What was invoiced on this date, by document and by rate.
 *
 * From the frozen invoice lines, never from the folio: the folio can still
 * change, and a day close that changes after it was printed is not a close.
 */
export async function dayClose(date: string): Promise<DayCloseRow[]> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();

  const invoices = await sql.rows<any>(
    `SELECT id, invoice_number, series, status
       FROM invoices
      WHERE organization_id = ?
        AND ${sql.dialect.day('issued_at')} = ?
      ORDER BY invoice_number`,
    [organizationId, date],
  );
  if (invoices.length === 0) return [];

  const out: DayCloseRow[] = [];
  for (const inv of invoices) {
    const groups = await sql.rows<any>(
      `SELECT vat_rate, gross_amount, net_amount, tax_amount
         FROM fin_invoice_tax_totals
        WHERE organization_id = ? AND invoice_id = ?
        ORDER BY vat_rate DESC`,
      [organizationId, inv.id],
    );
    out.push({
      invoice_number: String(inv.invoice_number),
      series: inv.series ?? null,
      status: String(inv.status),
      gross: groups.reduce((s, g) => s + Number(g.gross_amount), 0),
      by_rate: groups.map((g) => ({
        vat_rate: Number(g.vat_rate),
        gross: Number(g.gross_amount),
        net: Number(g.net_amount),
        tax: Number(g.tax_amount),
      })),
    });
  }
  return out;
}

function toStay(r: any): StayRow {
  return {
    reservation_id: String(r.reservation_id),
    unit_code: r.unit_code ?? null,
    unit_name: r.unit_name ?? null,
    category: r.category ?? null,
    guest_name: [r.first_name, r.last_name].filter(Boolean).join(' ') || '—',
    check_in: day(r.check_in),
    check_out: day(r.check_out),
    adults: Number(r.adults) || 0,
    children: Number(r.children) || 0,
    nights: Number(r.nights) || 0,
    notes: r.notes ?? null,
    status: String(r.status),
  };
}

function day(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v ?? '').slice(0, 10);
}
