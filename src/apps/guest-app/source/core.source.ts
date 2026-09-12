/**
 * Джерело `core`: готель уже живе в нас, тож наявність і ціну знає ядро.
 *
 * ── Що тут СВОГО, а що позичене ─────────────────────────────────────────
 *
 * Свого — нічого, і це навмисно. Вільні кімнати рахує `freeUnitsForRange`
 * (`@properties`), ціну — `calculateQuote` → `priceNights()` (`@pricing`),
 * тарифи — `listRatePlans` (`@pricing/plans`). Усі троє вже вміють те, чого
 * звідси не видно: перший віднімає ємнісний тиск броней без номера (інакше
 * дві кімнати «якісь» продалися б утретє), другий знає матрицю заселеності,
 * тарифи, правила цін і промо, третій — які тарифи готель зняв із продажу.
 *
 * Другий розрахунок будь-чого з цих трьох був би порушенням інваріантів 16
 * та И3 — а головне, розійшовся б із першим у тижні, коли ніхто не дивиться.
 */

import { getSql } from '@core/db/async';
import { money } from '@core/money';
import { freeUnitsForRange } from '@properties/kernel';
import { calculateQuote } from '@pricing/quote';
import { listRatePlans } from '@pricing/plans';
import type { StayOffer, StayQuery, StaySource } from '../domain/port';

/** Тариф у тому вигляді, у якому його показують гостю. `null` — базова ціна типу. */
interface OfferedPlan {
  id: string | null;
  name: string | null;
  mealPlan: string | null;
  cancellationPolicy: string | null;
}

const BASE_ONLY: OfferedPlan[] = [{ id: null, name: null, mealPlan: null, cancellationPolicy: null }];

export const coreSource: StaySource = {
  kind: 'core',

  async offers(query: StayQuery): Promise<StayOffer[]> {
    const sql = getSql();
    // Типи ЦЬОГО обʼєкта, які готель узагалі дозволив продавати онлайн.
    // `bookable_online` — рішення готелю, і його не можна обходити тому, що
    // кімната випадково вільна.
    const types = await sql.rows<{ id: string; name: string }>(
      `SELECT ut.id, ut.name
         FROM unit_types ut
         JOIN properties p ON p.id = ut.property_id
        WHERE ut.property_id = ? AND p.organization_id = ?
          AND ut.bookable_online = TRUE
        ORDER BY ut.name`,
      [query.propertyId, query.organizationId],
    );

    // Тарифи, які готель справді продає: знятий із продажу (`isActive`) не
    // має ціни ні для кого (Блок 2.1), прихований (`isHidden`) готель прибрав
    // саме з публічних поверхонь — а це одна з них.
    //
    // Готель без жодного видимого тарифу продається за базовою ціною типу, і
    // це не збій, а найчастіший випадок: більшість малих готелів заводить
    // ціни в календар без жодного тарифу.
    const plans = (await listRatePlans(query.propertyId))
      .filter((p) => p.isActive && !p.isHidden);
    const offered: OfferedPlan[] = plans.length === 0 ? BASE_ONLY : plans.map((p) => ({
      id: p.id, name: p.name, mealPlan: p.mealPlan, cancellationPolicy: p.cancellationPolicy,
    }));

    const result: StayOffer[] = [];
    for (const type of types) {
      const units = await sql.rows<{ id: string }>(
        'SELECT id FROM units WHERE unit_type_id = ? AND property_id = ?',
        [type.id, query.propertyId],
      );
      if (units.length === 0) continue;

      const free = await freeUnitsForRange(units.map((u) => u.id), query.from, query.to);
      if (free.size === 0) continue;

      for (const plan of offered) {
        const quote = await calculateQuote(type.id, query.from, query.to, query.adults, 0,
          { ratePlanId: plan.id });
        // Ціни, якої немає, не існує (інваріант 17). Пара «тип × тариф», якій
        // бракує ціни хоч на одну ніч, із списку ВИПАДАЄ — гість не має
        // обирати умову, суму за яку ми назвати не можемо. Це не те саме, що
        // «немає вільних»: там кімнати немає, тут немає ціни, і обидва
        // випадки просто не показуються.
        if (!quote.hasPricing || quote.missingDays > 0) continue;

        result.push({
          unitTypeId: type.id,
          name: type.name,
          ratePlanId: plan.id,
          ratePlanName: plan.name,
          mealPlan: plan.mealPlan,
          cancellationPolicy: plan.cancellationPolicy,
          free: free.size,
          total: quote.total,
          // Подання вже порахованої суми, а не друга ціна: ділиться `total`.
          perNight: quote.nights > 0 ? money(quote.total / quote.nights) : quote.total,
          currency: quote.currency,
          nights: quote.nights,
        });
      }
    }
    return result;
  },
};
