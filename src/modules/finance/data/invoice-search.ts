import { getSql } from '@core/db/async';
import { likePattern, SEARCH_LIMIT, type SearchHit } from '@core/search-types';

/**
 * Знайти фактуру за номером або платником.
 *
 * `custom_buyer_name` у пошуку разом із номером: фактура компанії виписується
 * на юридичну особу, і бухгалтер шукає її саме за назвою фірми, а не за
 * номером, якого не памʼятає.
 *
 * Валюта береться з рядка фактури й НЕ має запасного значення. Фактура — це
 * документ; сума без правильної валюти на ньому не «майже правильна», вона
 * інша. Порожньо тут означає, що на документі валюти немає, і це видно.
 */
export async function searchInvoices(term: string, organizationId: string): Promise<SearchHit[]> {
  const sql = getSql();
  const p = likePattern(term);
  const like = sql.dialect.ilike;

  const rows = await sql.rows<any>(`
    SELECT id, invoice_number, issued_at, amount, currency, status,
           custom_buyer_name, is_credit_note
    FROM invoices
    WHERE organization_id = ?
      AND (${like('invoice_number')} OR ${like('custom_buyer_name')})
    ORDER BY issued_at DESC
    LIMIT ${SEARCH_LIMIT}
  `, [organizationId, p, p]);

  return rows.map((i: any) => {
    const month = isoDay(i.issued_at).slice(0, 7);
    return {
      id: String(i.id),
      title: [i.invoice_number, i.is_credit_note ? '(сторно)' : null].filter(Boolean).join(' '),
      subtitle: [
        i.custom_buyer_name,
        i.amount != null ? `${i.amount} ${i.currency ?? ''}`.trim() : null,
        i.status,
      ].filter(Boolean).join(' · ') || undefined,
      // Місяць у посиланні — щоб екран документів відкрився там, де фактура
      // справді лежить. Без нього людина потрапляє на поточний місяць і
      // шукає ще раз, уже руками.
      href: `/app/documents?tab=invoices${month ? `&month=${month}` : ''}`,
    };
  });
}

/** `issued_at` — TEXT у SQLite і TIMESTAMPTZ у Postgres; беремо день як рядок. */
function isoDay(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
