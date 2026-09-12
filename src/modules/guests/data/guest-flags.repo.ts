/**
 * VIP і чорний список — ознаки, які вирішують, ЯК готель поводиться з людиною.
 *
 * ── Чому окремий писач, а не два рядки в `fieldMap` ─────────────────────
 *
 * `updateGuest` збирає зміни мапою «ключ форми → колонка» і кладе значення
 * так: `values.push(body[jsKey] || null)`. Для тексту це нешкідливо, для
 * ПРАПОРЦЯ — ні: `false || null` це `null`, тобто «зняти VIP» записало б
 * NULL у `NOT NULL` колонку. Помилка вилізла б не там, де причина, і не в
 * того, хто її зробив.
 *
 * Друга причина важливіша за першу. Чорний список має ПРАВИЛО, якого в мапі
 * не висловити: причина обовʼязкова. Прапорець без причини й автора — це
 * відмова живій людині, яку наступна зміна не може ні пояснити гостеві, ні
 * оскаржити перед власником; а зняти блокування можна лише разом із
 * причиною, інакше в картці лишається текст про людину, яку вже розблокували.
 *
 * ── Орендар — у SQL ─────────────────────────────────────────────────────
 *
 * `guests` під політикою на Postgres, але на SQLite політик немає взагалі
 * (AGENTS §7), тож умова стоїть у самому запиті. Рядок, якого не знайшли, —
 * це ВІДМОВА (`false`), а не «отже, обмежень немає» (інваріант 13).
 */
import { getSql } from '@core/db/async';
import { refuse } from '@core/http/refusal';

/** Хто натиснув і чому. Автор — із сесії, ніколи з тіла запиту. */
export interface BlacklistInput {
  organizationId: string;
  guestId: string;
  reason: string;
  by: string;
}

/**
 * Поставити або зняти VIP. `false` — такого гостя в нас немає (404 вище).
 *
 * `TRUE`/`FALSE` літералами, не `1`/`0`: колонка BOOLEAN, і Postgres
 * літеральну одиницю відхиляє (інваріант 12).
 */
export async function setVip(organizationId: string, guestId: string, isVip: boolean): Promise<boolean> {
  const sql = getSql();
  const res = await sql.run(
    `UPDATE guests SET is_vip = ${isVip ? 'TRUE' : 'FALSE'}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`,
    [guestId, organizationId]);
  return res.changes > 0;
}

/**
 * Заблокувати гостя. Без причини — НАЗВАНА відмова, а не тихий запис.
 *
 * Автор і час ставить сервер: якби вони приходили з тіла, перший же експорт
 * чи скрипт написав би туди що завгодно, і підпис під відмовою гостеві
 * перестав би щось означати.
 */
export async function blacklistGuest(input: BlacklistInput): Promise<boolean> {
  const reason = input.reason?.trim() ?? '';
  if (!reason) {
    refuse('Причина блокування обовʼязкова — без неї наступна зміна не знатиме, чому гостю відмовлено', 400);
  }
  const sql = getSql();
  const res = await sql.run(
    `UPDATE guests SET blacklisted_at = CURRENT_TIMESTAMP, blacklisted_by = ?, blacklist_reason = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`,
    [input.by, reason, input.guestId, input.organizationId]);
  return res.changes > 0;
}

/**
 * Зняти блокування — ВСІ ТРИ колонки разом.
 *
 * Лишити причину «на памʼять» означало б картку, де гість не заблокований, а
 * текст про його блокування стоїть: наступний портьє прочитає саме текст.
 */
export async function unblacklistGuest(organizationId: string, guestId: string): Promise<boolean> {
  const sql = getSql();
  const res = await sql.run(
    `UPDATE guests SET blacklisted_at = NULL, blacklisted_by = NULL, blacklist_reason = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`,
    [guestId, organizationId]);
  return res.changes > 0;
}
