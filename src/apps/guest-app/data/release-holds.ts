/**
 * Номер, який ніхто не підтвердив, повертається в продаж.
 *
 * ── Навіщо крон, а не перевірка при читанні ─────────────────────────────
 *
 * Спокусливо було б не мати кажучого крона взагалі: пропозиції могли б просто
 * не рахувати прострочені броні, і кімната виглядала б вільною сама собою.
 * Так не можна з двох причин, і обидві коштують грошей:
 *
 *   `no_double_booking` рахує РЯДОК, а не наше про нього уявлення. Кімната,
 *     «вільна» на екрані, відмовила б на записі — гість дістав би відмову
 *     після того, як обрав;
 *   шахматка рецепції, канал і звіти читають ту саму таблицю іншим кодом.
 *     Правда, яку знає лише один читач, — це не правда, а його думка.
 *
 * Тому строк знімається РЯДКОМ: бронь стає `cancelled`, номер звільняється
 * для всіх однаково, а канал дізнається про ночі, що повернулись у продаж.
 *
 * ── Чому `cancelled`, а не видалення ────────────────────────────────────
 *
 * Рецепція наступного ранку має бачити, що спроба була: три скасовані спроби
 * на один номер за вечір — це або зламаний крок, або гість, який не може
 * дочитати екран. Видалений рядок не розповідає нічого.
 */
import { getSql, type Sql } from '@core/db/async';
import { runWithOrganization } from '@core/auth/tenant-context';
import { noteAvailabilityChanged, lastNight } from '@channels/outbox';
import { ALL_PROPERTIES, propertyScopeFilter } from '@core/property-scope';

export interface ReleaseResult {
  released: number;
  failedOrganizations: number;
}

/**
 * Зняти всі броні, чий строк минув, по всіх готелях.
 *
 * `now` — щоб гейт міг назвати момент сам, не чекаючи пів години.
 */
export async function releaseExpiredHolds(now: Date = new Date()): Promise<ReleaseResult> {
  const sql = getSql();
  const orgs = await sql.rows<{ id: string }>('SELECT id FROM organizations');
  const moment = now.toISOString();

  let released = 0;
  let failedOrganizations = 0;

  for (const org of orgs) {
    try {
      released += await runWithOrganization(org.id, () => releaseForOrganization(sql, moment, org.id));
    } catch (e) {
      // Один готель, який упав, не має зупиняти решту: крон ходить раз на
      // кілька хвилин, і зупинка на першій помилці лишила б кімнати
      // заблокованими в усіх готелях за ним.
      failedOrganizations += 1;
      console.error('[guest-app] звільнення прострочених броней:', org.id, e);
    }
  }

  return { released, failedOrganizations };
}

async function releaseForOrganization(sql: Sql, moment: string, organizationId: string): Promise<number> {
  // Порівняння з ПАРАМЕТРОМ, а не з `now()` бази. На Postgres колонка —
  // timestamptz, на SQLite — текст ISO; `datetime('now')` дало б там
  // 'YYYY-MM-DD HH:MM:SS', що з ISO-рядком не порівнюється лексикографічно, і
  // строк не наставав би НІКОЛИ — мовчки, без жодної помилки.
  // Вісь обʼєкта — ALL_PROPERTIES, і це рішення: крон звільняє кімнати в
  // УСІХ будинках готелю. Звузити його до одного означало б, що другий
  // будинок тримає невідтверджені броні вічно — мовчки, бо ніхто не помітить
  // кімнати, якої просто немає в продажу.
  const everyHouse = propertyScopeFilter(ALL_PROPERTIES, '');
  const due = await sql.rows<{
    id: string; property_id: string; unit_type_id: string | null;
    check_in: string; check_out: string;
  }>(
    `SELECT id, property_id, unit_type_id, check_in, check_out
       FROM reservations
      WHERE status = 'tentative'
        AND hold_expires_at IS NOT NULL
        AND hold_expires_at < ?
        AND organization_id = ?
        AND ${everyHouse.sql}`,
    [moment, organizationId, ...everyHouse.params]);

  let count = 0;
  for (const row of due) {
    await sql.tx(async (t) => {
      // Умова статусу стоїть і тут: гість міг натиснути «підтвердити» в ту
      // саму секунду, і тоді скасовувати нема чого.
      const changed = await t.run(
        `UPDATE reservations
            SET status = 'cancelled', hold_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND organization_id = ? AND status = 'tentative' AND hold_expires_at IS NOT NULL`,
        [row.id, organizationId]);
      if (changed.changes === 0) return;
      count += 1;
      if (row.unit_type_id) {
        await noteAvailabilityChanged(t, {
          propertyId: row.property_id, unitTypeId: row.unit_type_id,
          from: row.check_in, to: lastNight(row.check_out),
        });
      }
    });
  }
  return count;
}
