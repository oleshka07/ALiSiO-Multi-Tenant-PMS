import { money } from '@core/money';

/**
 * Надбавки за заселеність — чисте правило (Блок 2 крок 3, Ц30; Hoteliera
 * «Extra occupancy»).
 *
 * Ніч = ціна тарифу за `base_occupancy` дорослих + Σ надбавок за кожного
 * дорослого понад базу + Σ надбавок за кожну дитину за її віковою вилкою.
 * Надбавка — проживання і, окремо, харчування; кожне — відсоток від ціни
 * ночі або сума в валюті тарифу. Правило обирається за точністю: тариф × тип
 * точніше за тариф, тариф — за тип, тип — за «усі»; для дитини правило на її
 * вилку точніше за «на всі вилки».
 *
 * Чого тут НЕМАЄ навмисно:
 *   - знижки за меншу заселеність: дорослих менше бази — ціна бази; правило
 *     «мінус за одного» готель не заявляв, а вигадувати його — інваріант 17;
 *   - вгадування віку: правила по вилках без відомого віку дитини — не
 *     «перша вилка», а `child_ages_required`; рятує лише правило «на всі
 *     вилки»;
 *   - тихої безкоштовної дитини: дитина без правила — `child_rule_missing`,
 *     ніч без ціни. Нуль у правилі — «діти безкоштовно», і його називає
 *     готель.
 *
 * «За номер» (Ц26): доплат за дорослих понад базу не буває, дитячі лишаються.
 */

export type GuestKind = 'adult' | 'child';
export const GUEST_KINDS: readonly GuestKind[] = ['adult', 'child'];
export type SurchargeMode = 'fixed' | 'percent';
export const SURCHARGE_MODES: readonly SurchargeMode[] = ['fixed', 'percent'];

/** Дорослий — від цього віку; вилки дітей закінчуються на попередньому році. */
export const ADULT_AGE = 18;

export interface AgeBand { from: number; to: number }

export interface OccupancyRule {
  id: string;
  /** NULL — усі тарифи обʼєкта. */
  ratePlanId: string | null;
  /** NULL — усі типи обʼєкта. */
  unitTypeId: string | null;
  guestKind: GuestKind;
  /** Лише для дитини: індекс вилки з `bandsFrom`; NULL — на всі вилки. */
  ageBandIndex: number | null;
  lodgingMode: SurchargeMode | null;
  lodgingValue: number | null;
  mealMode: SurchargeMode | null;
  mealValue: number | null;
  /** Гість займає додаткове ліжко — довідково для віджета й каналу. */
  extraBed: boolean;
}

export type SurchargeMissing = 'adult_rule_missing' | 'child_rule_missing' | 'child_ages_required';

export interface SurchargeItem {
  kind: GuestKind;
  ruleId: string;
  amount: number;
  bandIndex?: number | null;
}

export interface NightSurcharges {
  total: number;
  items: SurchargeItem[];
  /** Названо, чому ніч не можна оцінити; тоді `total` і `items` не мають значення. */
  missing?: SurchargeMissing;
}

/** Вилки з меж: `[]` → 0–17; `[3, 12]` → 0–2, 3–11, 12–17. Межа входить у старшу вилку. */
export function bandsFrom(boundaries: readonly number[]): AgeBand[] {
  const cuts = [...new Set(boundaries.map((b) => Math.trunc(Number(b))).filter((b) => Number.isFinite(b) && b > 0 && b < ADULT_AGE))].sort((a, b) => a - b);
  const out: AgeBand[] = [];
  let from = 0;
  for (const cut of cuts) { out.push({ from, to: cut - 1 }); from = cut; }
  out.push({ from, to: ADULT_AGE - 1 });
  return out;
}

/** Індекс вилки для віку; від `ADULT_AGE` — `null` (дорослий). */
export function bandIndexFor(age: number, bands: readonly AgeBand[]): number | null {
  const a = Math.trunc(Number(age));
  if (!Number.isFinite(a) || a < 0 || a >= ADULT_AGE) return null;
  const i = bands.findIndex((b) => a >= b.from && a <= b.to);
  return i < 0 ? null : i;
}

/**
 * Найточніше правило для гостя. `bandIndex` невідомий — для дитини підходить
 * лише правило «на всі вилки».
 */
export function pickRule(
  rules: readonly OccupancyRule[],
  who: { guestKind: GuestKind; ratePlanId: string | null; unitTypeId: string | null; bandIndex?: number | null },
): OccupancyRule | null {
  let best: OccupancyRule | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (r.guestKind !== who.guestKind) continue;
    if (r.ratePlanId != null && r.ratePlanId !== who.ratePlanId) continue;
    if (r.unitTypeId != null && r.unitTypeId !== who.unitTypeId) continue;
    if (who.guestKind === 'child' && r.ageBandIndex != null) {
      if (who.bandIndex == null || r.ageBandIndex !== who.bandIndex) continue;
    }
    const score = (r.ratePlanId != null ? 4 : 0) + (r.unitTypeId != null ? 2 : 0) + (r.ageBandIndex != null ? 1 : 0);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

/** Скільки коштує один гість за цим правилом на ніч із ціною `nightPrice`. */
export function surchargeOf(rule: OccupancyRule, nightPrice: number): number {
  const part = (mode: SurchargeMode | null, value: number | null): number => {
    if (mode == null || value == null) return 0;
    return mode === 'percent' ? nightPrice * (value / 100) : value;
  };
  return money(part(rule.lodgingMode, rule.lodgingValue) + part(rule.mealMode, rule.mealValue));
}

/** Чи є для цих тарифу й типу правило по вилках — тоді без віку дитини ціни немає. */
function hasBandedChildRule(rules: readonly OccupancyRule[], ratePlanId: string | null, unitTypeId: string | null): boolean {
  return rules.some((r) => r.guestKind === 'child' && r.ageBandIndex != null
    && (r.ratePlanId == null || r.ratePlanId === ratePlanId)
    && (r.unitTypeId == null || r.unitTypeId === unitTypeId));
}

export function nightSurcharges(input: {
  rules: readonly OccupancyRule[];
  /** Ціна ночі за базову заселеність — від неї рахуються відсотки. */
  nightPrice: number;
  adults: number;
  children: number;
  /** Вік кожної дитини, коли відомий; довжина — `children`. */
  childrenAges?: readonly number[] | null;
  sellMode: 'per_room' | 'per_person';
  ratePlanId: string | null;
  unitTypeId: string | null;
  baseOccupancy: number;
  bands: readonly AgeBand[];
}): NightSurcharges {
  const items: SurchargeItem[] = [];
  const { rules, nightPrice, ratePlanId, unitTypeId } = input;

  // Дорослі понад базу — по надбавці кожному; «за номер» — жодної.
  const extraAdults = input.sellMode === 'per_room' ? 0 : Math.max(0, Math.trunc(input.adults) - Math.trunc(input.baseOccupancy));
  if (extraAdults > 0) {
    const rule = pickRule(rules, { guestKind: 'adult', ratePlanId, unitTypeId });
    if (!rule) return { total: 0, items: [], missing: 'adult_rule_missing' };
    const each = surchargeOf(rule, nightPrice);
    for (let i = 0; i < extraAdults; i++) items.push({ kind: 'adult', ruleId: rule.id, amount: each });
  }

  const children = Math.max(0, Math.trunc(input.children));
  if (children > 0) {
    const ages = input.childrenAges && input.childrenAges.length === children ? input.childrenAges : null;
    for (let i = 0; i < children; i++) {
      const bandIndex = ages ? bandIndexFor(ages[i], input.bands) : null;
      const rule = pickRule(rules, { guestKind: 'child', ratePlanId, unitTypeId, bandIndex: ages ? bandIndex : undefined });
      if (!rule) {
        const why: SurchargeMissing = !ages && hasBandedChildRule(rules, ratePlanId, unitTypeId) ? 'child_ages_required' : 'child_rule_missing';
        return { total: 0, items: [], missing: why };
      }
      items.push({ kind: 'child', ruleId: rule.id, amount: surchargeOf(rule, nightPrice), bandIndex: ages ? bandIndex : rule.ageBandIndex });
    }
  }

  return { total: money(items.reduce((s, i) => s + i.amount, 0)), items };
}

/** Правило на ту саму клітинку (тариф × тип × гість × вилка) — конфлікт; `exceptId` — саме правило при зміні. */
export function ruleConflict(rules: readonly OccupancyRule[], candidate: OccupancyRule, exceptId?: string | null): OccupancyRule | null {
  return rules.find((r) => r.id !== (exceptId ?? candidate.id)
    && r.guestKind === candidate.guestKind
    && (r.ratePlanId ?? null) === (candidate.ratePlanId ?? null)
    && (r.unitTypeId ?? null) === (candidate.unitTypeId ?? null)
    && (r.ageBandIndex ?? null) === (candidate.ageBandIndex ?? null)) ?? null;
}
