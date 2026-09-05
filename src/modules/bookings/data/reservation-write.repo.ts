/**
 * Запис зміни броні — усе, що має статись РАЗОМ, в одній транзакції.
 *
 * Хендлер `PATCH /api/bookings/[id]` вирішує, ЩО міняти (варти, дозволені
 * колонки, 422/409); тут — як це лягає в базу так, щоб падіння будь-якого
 * кроку не лишало половини:
 *
 *   1. сам UPDATE броні;
 *   2. ночі в каналі: стан ДО звільняє старі, стан ПІСЛЯ займає нові
 *      (`noteStay`, тією ж ручкою — інваріант 11);
 *   3. дзеркалення в дочірні броні і їхні ночі;
 *   4. виселення → номер броні (і номери дочірніх) стають `dirty` через
 *      `@properties/kernel` із рядком журналу прибирання (0092). Падіння
 *      запису журналу відкочує СТАТУС: виселена бронь із чистим номером,
 *      про який ніхто не знає, гірша за відмову.
 *
 * Сцена — `reservation-write.repo.check.ts`.
 */
import type { Sql } from '@core/db/async';
import { setCleaningStatus } from '@properties/kernel';
import { noteStay, stayById, staysOfParent } from './stay-notes';

export interface CascadeFields {
  status?: string;
  payment_status?: string;
  check_in?: string;
  check_out?: string;
  nights?: number;
  source?: string;
}

export async function writeReservationChange(sql: Sql, input: {
  organizationId: string;
  reservationId: string;
  /** Готовий UPDATE головної броні і його параметри (останній — id). */
  statement: string;
  values: unknown[];
  /** Чи рухає зміна ночі (номер, дати, статус) — тоді канал сповіщається. */
  movesStay: boolean;
  /** Що дзеркалити в дочірні броні. */
  cascade: CascadeFields;
  /** Виселення: хто виселяє — автор рядка прибирання; null — без бруднення. */
  checkout?: { changedBy: string | null } | null;
}): Promise<void> {
  const { reservationId: id } = input;
  await sql.tx(async (t) => {
    const stayBefore = input.movesStay ? await stayById(t, id) : undefined;
    const childrenBefore = input.movesStay ? await staysOfParent(t, id) : [];

    await t.run(input.statement, input.values);
    if (stayBefore) {
      await noteStay(t, stayBefore);
      await noteStay(t, await stayById(t, id));
    }

    // ── Дочірні броні рухаються разом із головною — і їхні ночі теж ──────
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['status', 'payment_status', 'check_in', 'check_out', 'nights', 'source'] as const) {
      const v = input.cascade[key];
      if (v !== undefined && v !== null && v !== '') { fields.push(`${key} = ?`); values.push(v); }
    }
    if (fields.length > 0) {
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      await t.run(`UPDATE reservations SET ${fields.join(', ')} WHERE parent_id = ?`, values);
      for (const child of childrenBefore) await noteStay(t, child);
      for (const child of await staysOfParent(t, id)) await noteStay(t, child);
    }

    // ── Виселення: номер (і номери дочірніх) — брудні, з рядком журналу ──
    if (input.checkout) {
      const rows = await t.rows<any>(
        'SELECT unit_id FROM reservations WHERE (id = ? OR parent_id = ?) AND unit_id IS NOT NULL',
        [id, id]);
      const units = [...new Set(rows.map((r: any) => String(r.unit_id)))];
      for (const unitId of units) {
        await setCleaningStatus(t, {
          organizationId: input.organizationId, unitId, to: 'dirty',
          changedBy: input.checkout.changedBy, source: 'checkout',
        });
      }
    }
  });
}
