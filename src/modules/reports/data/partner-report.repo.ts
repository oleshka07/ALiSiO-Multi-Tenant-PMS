/**
 * A finished report, stored whole and addressed by a link.
 *
 * Not a rendering of live data. A partner report is a statement about a closed
 * month: the numbers were agreed, the document was sent, and it must read the
 * same in December as it did in July. Regenerating it from current data would
 * quietly change history every time a booking is corrected, which is precisely
 * what a report is supposed to prevent. So the HTML is written once and served
 * back byte for byte.
 *
 * It lives in the database rather than on disk because the server is rebuilt
 * from its image on every deploy — a file written beside the application is
 * gone with the next one. In the row it is also covered by the same pg_dump
 * that backs up everything else, rather than by a second thing to remember.
 *
 * The token is the whole credential, so reading by token is the one operation
 * that happens outside a tenant. It works the same way the guest portal does:
 * the token goes onto the connection and the row-level policy matches the one
 * row whose `token` equals it. Everything after that runs as the hotel that
 * owns the report.
 */
import { getSql } from '@core/db/async';
import { generateReportToken } from '@core/db';
import { runWithPublicToken, runWithOrganization, requireOrganizationId } from '@core/auth/tenant-context';

export interface PartnerReport {
  id: string;
  organization_id: string;
  property_id: string | null;
  token: string;
  slug: string | null;
  title: string;
  period: string | null;
  html: string;
  published_at: string;
  revoked_at: string | null;
  views: number;
  last_viewed_at: string | null;
}

/** Everything but the document — for lists, where the HTML would be megabytes. */
export type PartnerReportSummary = Omit<PartnerReport, 'html'>;

const COLUMNS_WITHOUT_HTML =
  'id, organization_id, property_id, token, slug, title, period, published_at, revoked_at, views, last_viewed_at';

/**
 * Read a report by the token in its URL, from outside any tenant.
 *
 * Returns null for a token that names nothing, a revoked one, and one whose
 * row has no organization. The caller answers 404 to all three: any other
 * answer tells a stranger which tokens exist.
 */
export async function readPublishedReport(token: string | null | undefined): Promise<PartnerReport | null> {
  if (!token) return null;
  // Cheap rejection before touching the database: every token this system
  // issues is 64 hex characters, so anything else is a scan, not a visitor.
  if (!/^[0-9a-f]{64}$/.test(token)) return null;

  const report = await runWithPublicToken(token, () =>
    getSql().row<PartnerReport>('SELECT * FROM partner_reports WHERE token = ?', [token]));

  if (!report?.organization_id) return null;
  if (report.revoked_at) return null;
  return report;
}

/**
 * Count a read.
 *
 * Deliberately after the response is decided and never in its way: a failure
 * here must not stop a partner seeing their report. It runs as the owning
 * hotel — the token's read window closed with the SELECT above, and a write
 * under a token is something the policy refuses anyway (WITH CHECK).
 */
export async function recordView(report: PartnerReport): Promise<void> {
  try {
    await runWithOrganization(report.organization_id, () =>
      getSql().run(
        'UPDATE partner_reports SET views = views + 1, last_viewed_at = ? WHERE id = ?',
        [new Date().toISOString(), report.id],
      ));
  } catch {
    // A view counter is not worth a 500.
  }
}

export interface PublishInput {
  title: string;
  html: string;
  period?: string | null;
  slug?: string | null;
  propertyId?: string | null;
  /** Replace the report already published for this period instead of adding one. */
  replace?: boolean;
}

/**
 * Publish a report and return it, token included.
 *
 * Republishing the same period keeps the token by default, because the link is
 * already in somebody's inbox: correcting a number should not mean sending
 * everyone a new URL. Pass `replace: false` to mint a separate report instead.
 */
export async function publishReport(input: PublishInput): Promise<PartnerReportSummary> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const replace = input.replace !== false;

  // Звіт ідентифікується парою «період × ОБʼЄКТ» (INC-033).
  //
  // Тут стояв пошук за самим періодом, а `UPDATE` нижче переписував і
  // `property_id`. Наслідок: готель із двома обʼєктами, публікуючи вересневий
  // звіт обʼєкта Б, знаходив вересневий звіт обʼєкта А і переписував його В
  // ТОМУ Ж РЯДКУ — той самий `id`, той самий ТОКЕН, нова належність. Посилання,
  // яке партнер А вже мав у пошті, починало показувати числа Б. Це не «оператор
  // бачить зайве», а «стороння людина бачить чуже»: `/report/[token]` відкриває
  // партнер.
  //
  // `IS NOT DISTINCT FROM`, не `= ?`: звіт по всьому рахунку має
  // `property_id IS NULL`, а `= ?` з NULL не збігається ніколи — тобто такий
  // звіт при кожній публікації додавав би новий рядок і новий токен замість
  // заміни. Postgres не приймає параметра після `IS`, SQLite пише це як `IS ?`;
  // спільна форма — ця (той самий випадок, що у `fin_budgets`).
  const existing = replace && input.period
    ? await sql.row<PartnerReportSummary>(
        `SELECT ${COLUMNS_WITHOUT_HTML} FROM partner_reports
          WHERE organization_id = ? AND period = ? AND revoked_at IS NULL
            AND property_id IS NOT DISTINCT FROM ?
          ORDER BY published_at DESC LIMIT 1`,
        [organizationId, input.period, input.propertyId ?? null],
      )
    : null;

  if (existing) {
    // `property_id` НЕ оновлюється: рядок знайдено за належністю, вона в нього
    // вже така. Рядок з іншою належністю — це інший звіт, і він публікується
    // новим рядком із новим токеном (гілка нижче).
    await sql.run(
      `UPDATE partner_reports
          SET title = ?, html = ?, slug = ?, published_at = ?
        WHERE id = ? AND organization_id = ?`,
      [input.title, input.html, input.slug ?? existing.slug,
       new Date().toISOString(), existing.id, organizationId],
    );
    return { ...existing, title: input.title, slug: input.slug ?? existing.slug };
  }

  const id = crypto.randomUUID();
  const token = generateReportToken();
  const publishedAt = new Date().toISOString();
  await sql.run(
    `INSERT INTO partner_reports (id, organization_id, property_id, token, slug, title, period, html, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizationId, input.propertyId ?? null, token, input.slug ?? null,
     input.title, input.period ?? null, input.html, publishedAt],
  );

  // Built from what was written rather than read back. Reading back would mean
  // a second query returning the same values, and the one thing that could
  // differ — a default the database filled in — is not something this table
  // has: every column above is given explicitly.
  return {
    id, organization_id: organizationId, property_id: input.propertyId ?? null,
    token, slug: input.slug ?? null, title: input.title, period: input.period ?? null,
    published_at: publishedAt, revoked_at: null, views: 0, last_viewed_at: null,
  };
}

/** Every report this hotel has published, newest first, without the documents. */
export async function listReports(): Promise<PartnerReportSummary[]> {
  const organizationId = await requireOrganizationId();
  return getSql().rows<PartnerReportSummary>(
    `SELECT ${COLUMNS_WITHOUT_HTML} FROM partner_reports
      WHERE organization_id = ? ORDER BY published_at DESC`,
    [organizationId],
  );
}

/**
 * Kill a link without losing the report.
 *
 * A leaked URL cannot be un-sent, so the only remedy is to make it stop
 * working. The row stays: the numbers are still the record of that month.
 */
export async function revokeReport(id: string): Promise<boolean> {
  const organizationId = await requireOrganizationId();
  const res = await getSql().run(
    'UPDATE partner_reports SET revoked_at = ? WHERE id = ? AND organization_id = ? AND revoked_at IS NULL',
    [new Date().toISOString(), id, organizationId],
  );
  return res.changes !== 0;
}

/** New address for the same report — the old link dies, the document lives. */
export async function rotateToken(id: string): Promise<string | null> {
  const organizationId = await requireOrganizationId();
  const token = generateReportToken();
  const res = await getSql().run(
    'UPDATE partner_reports SET token = ? WHERE id = ? AND organization_id = ?',
    [token, id, organizationId],
  );
  return res.changes === 0 ? null : token;
}
