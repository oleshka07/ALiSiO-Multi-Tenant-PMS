/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import type { QuoteResult } from '../domain/types';
import { priceNights } from './nightly-price';
import { applyFees } from '../domain/fees';

export async function calculateQuote(
  unitTypeId: string, checkIn: string, checkOut: string, adults = 2, children = 0,
  options: { ratePlanId?: string | null; promoCode?: string | null } = {},
): Promise<QuoteResult> {
  const sql = getSql();

  const start = new Date(checkIn);
  const end = new Date(checkOut);
  const nightsTotal = Math.round((end.getTime() - start.getTime()) / 86400000);

  // One resolver for every caller — see data/nightly-price.ts. The occupancy
  // matrix answers where it has a row for this category and this many guests,
  // the day calendar answers where it does not, and a night neither can price
  // is counted as missing rather than charged at zero.
  // Дорослі адресують матрицю, діти йдуть надбавкою за правилом (Ц30). Без
  // правила ніч із дітьми повертається як `missing` — видно оператору списком
  // дат, а не тишею (інваріант 17). Правила цін і промо (Ц31): оператор рахує
  // зараз (`bookedAt` сьогодні), канал — `operator`, промокод — коли названо.
  const priced = await priceNights({
    unitTypeId, checkIn, nights: nightsTotal, adults, children,
    ratePlanId: options.ratePlanId ?? null, channel: 'operator', promoCode: options.promoCode ?? null,
  });

  const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const breakdown: QuoteResult['breakdown'] = [];
  const byDate = new Map(priced.nights.map((n) => [n.date, n]));

  const current = new Date(start);
  for (let i = 0; i < nightsTotal; i++) {
    const dateStr = current.toISOString().split('T')[0];
    const dayOfWeek = current.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
    const night = byDate.get(dateStr);
    breakdown.push({
      date: dateStr, dayName: dayNames[dayOfWeek],
      price: night?.price ?? 0, isWeekend,
      source: night?.source,
      ...(night?.rules?.length ? { priceBeforeRules: night.priceBeforeRules, rules: night.rules.map((r) => ({ name: r.titleForGuest || r.name, delta: r.delta, kind: r.kind })) } : {}),
    });
    current.setDate(current.getDate() + 1);
  }

  const accommodationTotal = priced.total;
  const missingDays = priced.missing.length;

  // Fees & taxes
  let fees: any[] = [];
  try {
    // The fees are the ones belonging to the unit type being quoted. Reading
    // them from the first property in the table priced one hotel's stay with
    // another hotel's city tax and cleaning fee.
    const prop = await sql.row<any>('SELECT property_id AS id FROM unit_types WHERE id = ?', [unitTypeId]) as any;
    if (prop?.id) {
      fees = await sql.rows<any>('SELECT * FROM fees_taxes WHERE property_id = ? AND is_active = TRUE', [prop.id]) as any[];
    }
  } catch { /* fees_taxes may not exist */ }

  // `includedFees` — збори, які вже сидять у ціні ночі. Вони їдуть у квоту
  // окремим списком і НЕ входять у `feesTotal`: файл готелю обіцяє гостю
  // «показати, але не додати вдруге», і до цього виправлення квота обіцянку
  // порушувала — портьє називав суму, більшу за справжню.
  const { feeBreakdown, includedFees, feesTotal } = applyFees(fees, {
    nights: nightsTotal, adults, children, accommodationTotal,
  });

  // Валюта готелю, а не 'CZK'.
  //
  // Тут стояв літерал, і це та сама помилка, що A1 у фоліо: німецький готель
  // отримував квоту в кронах — на екрані, з якого портьє називає гостю ціну.
  // `folio.repo.ts` уже відмовляється вгадувати валюту документа; квота —
  // те саме число до того, як воно стане документом.
  //
  // Порожня організація — не привід підставити свою: краще показати ціну без
  // валюти, ніж не ту валюту, яку гість почує й запамʼятає.
  const currency = await quoteCurrency(sql, unitTypeId);

  // Розклад форми NORTHSTAR CP6: ціна без правил → правила → ціна без зборів → збори → разом.
  const rules = (priced.rulesApplied ?? []).map((r) => ({ name: r.titleForGuest || r.name, kind: r.kind, total: r.total }));
  return {
    unitTypeId, checkIn, checkOut, nights: nightsTotal, adults, children, breakdown,
    accommodationBeforeRules: priced.totalBeforeRules ?? accommodationTotal, rules,
    accommodationTotal, feeBreakdown, includedFees, feesTotal, total: accommodationTotal + feesTotal, currency, missingDays, hasPricing: missingDays < nightsTotal,
  };
}

/** Валюта організації, якій належить цей тип номера. */
async function quoteCurrency(sql: ReturnType<typeof getSql>, unitTypeId: string): Promise<string> {
  const row = await sql.row<any>(`
    SELECT o.default_currency AS currency
      FROM unit_types ut
      JOIN properties p ON p.id = ut.property_id
      JOIN organizations o ON o.id = p.organization_id
     WHERE ut.id = ?`, [unitTypeId]) as { currency?: string } | undefined;
  return row?.currency || '';
}
