/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { type Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';

/**
 * Оплачені послуги і чи дійшли вони до книг.
 *
 * ── Чому цей файл зʼявився в аудиті ──────────────────────────────────────
 *
 * Екран `/app/finance/payments/services` існував, мав повну таблицю, фільтри
 * за датами й перемикач «Тільки orphans» — і звертався до
 * `/api/finance/paid-services`, маршруту, якого не було. Тобто кнопка
 * «Послуги» на головному екрані фінансів відкривала сторінку, яка ЗАВЖДИ
 * писала «Оплачених послуг за цей період не знайдено». Не «даних немає», а
 * саме «не знайдено» — тобто відповідь, яку читають як факт про бізнес.
 *
 * Маршрут не вигаданий заново: `_guard.ts` уже тримає його в
 * FINANCE_TAB_BY_SEGMENT ('paid-services' → вкладка «operations»). Наміру
 * бракувало лише реалізації.
 *
 * ── Що таке orphan ───────────────────────────────────────────────────────
 *
 * Замовлення послуги, за яке гість заплатив, але жодна фінансова операція на
 * нього не посилається. Це не бухгалтерська тонкість: це гроші, які готель
 * узяв і які ніде не порахував — ні в P&L, ні в касовій книзі, ні в рахунку.
 * Звʼязок — `fin_operations.source_ref = <id замовлення>`, як його пише
 * `payment-bridge.ts`.
 *
 * ── Дві таблиці ──────────────────────────────────────────────────────────
 *
 * Замовлення живуть у двох місцях і це не помилка: `booking_service_orders` —
 * те, що гість додав у віджеті, `service_orders` — те, що він замовив зі своєї
 * сторінки. Обидві мають `payment_status`, і звіт має бачити обидві, інакше
 * половина грошей просто не потрапляє в поле зору.
 *
 * Орендар — через `additional_services → properties`: жодна з двох таблиць не
 * має organization_id, а послугу називає кожне замовлення.
 */

const PAID = "('paid', 'pending')";

export async function getPaidServices(request: NextRequest, _ctx: unknown, actor: Actor): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || '1970-01-01';
    const to = searchParams.get('to') || '2999-12-31';
    const onlyOrphans = searchParams.get('only_orphans') === '1';

    // `sql.dialect.day(...)`, а не `date(...)`: created_at — момент, from/to —
    // календарні дні, і без зрізу останній день діапазону не потрапляв би у
    // звіт. Через діалект, бо на Postgres це інша функція (check-dialect.mjs).
    const day = sql.dialect.day('o.created_at');
    const rows = await sql.rows<any>(`
      SELECT
        'booking_service_orders' AS source_table,
        o.id                     AS order_id,
        o.reservation_id,
        o.service_id,
        s.name                   AS service_name,
        o.quantity,
        o.total_price,
        o.payment_id,
        o.payment_status,
        o.service_date,
        o.options_json,
        o.created_at,
        COALESCE(r.currency, org.default_currency) AS currency,
        (g.first_name || ' ' || g.last_name)       AS guest_name,
        u.name                   AS unit_name,
        (SELECT f.id FROM fin_operations f
          WHERE f.organization_id = ? AND f.source_ref = o.id LIMIT 1) AS fin_operation_id
      FROM booking_service_orders o
      JOIN additional_services s ON s.id = o.service_id
      JOIN properties p          ON p.id = s.property_id
      JOIN organizations org     ON org.id = p.organization_id
      LEFT JOIN reservations r   ON r.id = o.reservation_id
      LEFT JOIN guests g         ON g.id = r.guest_id
      LEFT JOIN units u          ON u.id = r.unit_id
      WHERE p.organization_id = ?
        AND o.payment_status IN ${PAID}
        AND ${day} BETWEEN ? AND ?

      UNION ALL

      SELECT
        'service_orders'         AS source_table,
        o.id                     AS order_id,
        o.reservation_id,
        o.service_id,
        s.name                   AS service_name,
        o.quantity,
        o.total_price,
        o.payment_id,
        o.payment_status,
        o.service_date,
        NULL                     AS options_json,
        o.created_at,
        COALESCE(r.currency, org.default_currency) AS currency,
        (g.first_name || ' ' || g.last_name)       AS guest_name,
        u.name                   AS unit_name,
        (SELECT f.id FROM fin_operations f
          WHERE f.organization_id = ? AND f.source_ref = o.id LIMIT 1) AS fin_operation_id
      FROM service_orders o
      JOIN additional_services s ON s.id = o.service_id
      JOIN properties p          ON p.id = s.property_id
      JOIN organizations org     ON org.id = p.organization_id
      LEFT JOIN reservations r   ON r.id = o.reservation_id
      LEFT JOIN guests g         ON g.id = r.guest_id
      LEFT JOIN units u          ON u.id = r.unit_id
      WHERE p.organization_id = ?
        AND o.payment_status IN ${PAID}
        AND ${day} BETWEEN ? AND ?

      ORDER BY created_at DESC
    `, [
      actor.organizationId, actor.organizationId, from, to,
      actor.organizationId, actor.organizationId, from, to,
    ]);

    const orphans = rows.filter((r) => !r.fin_operation_id);
    // Фільтр застосовано ПІСЛЯ підрахунку: перемикач «Тільки orphans» звужує
    // список, а не підсумки — інакше він показував би, що сиріт 100 %.
    const services = onlyOrphans ? orphans : rows;

    // Підсумки за валютами, а не одним числом: у готелю може бути EUR і CZK
    // поруч, і додавати їх — це вигадувати курс, якого ніхто не називав.
    const totals_by_currency: Record<string, number> = {};
    for (const r of services) {
      const cur = r.currency || '—';
      totals_by_currency[cur] = (totals_by_currency[cur] || 0) + (Number(r.total_price) || 0);
    }

    return NextResponse.json({
      services,
      count: services.length,
      totals_by_currency,
      with_fin_operation: rows.length - orphans.length,
      orphan_count: orphans.length,
    });
  } catch (error: any) {
    return serverError('modules/finance/api/paid-services getPaidServices', error);
  }
}
