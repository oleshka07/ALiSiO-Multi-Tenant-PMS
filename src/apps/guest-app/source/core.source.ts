/**
 * Джерело `core`: готель уже живе в нас, тож наявність і ціну знає ядро.
 *
 * ── Що тут СВОГО, а що позичене ─────────────────────────────────────────
 *
 * Свого — нічого, і це навмисно. Вільні кімнати рахує `freeUnitsForRange`
 * (`@properties`), ціну — `calculateQuote` → `priceNights()` (`@pricing`).
 * Обидва вже вміють те, чого звідси не видно: перший віднімає ємнісний тиск
 * броней без номера (інакше дві кімнати «якісь» продалися б утретє), другий
 * знає матрицю заселеності, тарифи, правила цін і промо.
 *
 * Другий розрахунок будь-чого з цих двох був би порушенням інваріантів 16
 * та И3 — а головне, розійшовся б із першим у тижні, коли ніхто не дивиться.
 */

import { getSql } from '@core/db/async';
import { freeUnitsForRange } from '@properties/kernel';
import { calculateQuote } from '@pricing/quote';
import type { StayOffer, StayQuery, StaySource } from '../domain/port';

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

    const offers: StayOffer[] = [];
    for (const type of types) {
      const units = await sql.rows<{ id: string }>(
        'SELECT id FROM units WHERE unit_type_id = ? AND property_id = ?',
        [type.id, query.propertyId],
      );
      if (units.length === 0) continue;

      const free = await freeUnitsForRange(units.map((u) => u.id), query.from, query.to);
      if (free.size === 0) continue;

      const quote = await calculateQuote(type.id, query.from, query.to, query.adults, 0);
      // Ціни, якої немає, не існує (інваріант 17). Тип, якому бракує ціни хоч
      // на одну ніч, із списку ВИПАДАЄ — гість не має обирати кімнату, суму за
      // яку ми назвати не можемо. Це не те саме, що «немає вільних»: там
      // кімнати немає, тут немає ціни, і обидва випадки просто не показуються.
      if (!quote.hasPricing || quote.missingDays > 0) continue;

      offers.push({
        unitTypeId: type.id,
        name: type.name,
        free: free.size,
        total: quote.total,
        currency: quote.currency,
        nights: quote.nights,
      });
    }
    return offers;
  },
};
