import { getSql } from '@core/db/async';
import { likePattern, SEARCH_LIMIT, type SearchHit } from '@core/search-types';

/**
 * Знайти гостя за іменем, поштою чи телефоном.
 *
 * Живе в `@guests`, бо `guests` — таблиця цього модуля. Загальний пошук не
 * ходить сюди сам: він питає модуль, а модуль відповідає своєю формою. Так
 * колонка може переїхати всередині модуля, не ламаючи пошук.
 *
 * ── Орендар ─────────────────────────────────────────────────────────────
 *
 * `organization_id = ?` стоїть явно, хоча виклик уже під
 * `runWithOrganization` і політика Postgres відсіче чуже сама. Це не
 * дублювання про всяк випадок: на SQLite політик немає взагалі, а пошук —
 * рівно те місце, де їх відсутність видно найкраще. Без цієї умови
 * розробник на SQLite шукав би по всіх готелях і не помітив би.
 */
export async function searchGuests(term: string, organizationId: string): Promise<SearchHit[]> {
  const sql = getSql();
  const p = likePattern(term);
  const like = sql.dialect.ilike;

  // Ім'я і прізвище разом: людина шукає «Іван Петренко», а в базі це дві
  // колонки. Без склеєного варіанта такий запит не знаходить нічого — і це
  // саме те, як більшість людей шукає.
  const rows = await sql.rows<any>(`
    SELECT id, first_name, last_name, email, phone, country
    FROM guests
    WHERE organization_id = ?
      AND (
        ${like('first_name')}
        OR ${like('last_name')}
        OR ${like("COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')")}
        OR ${like('email')}
        OR ${like('phone')}
      )
    ORDER BY last_name, first_name
    LIMIT ${SEARCH_LIMIT}
  `, [organizationId, p, p, p, p, p]);

  return rows.map((g: any) => ({
    id: String(g.id),
    title: [g.first_name, g.last_name].filter(Boolean).join(' ') || String(g.id),
    subtitle: [g.email, g.phone, g.country].filter(Boolean).join(' · ') || undefined,
    href: `/app/guests?guest=${encodeURIComponent(String(g.id))}`,
  }));
}
