import { money } from '@core/money';

/**
 * Правила цін і промо — чисте правило (Блок 2 крок 4, Ц31; Hoteliera «Price
 * rules» / «Promos»).
 *
 * Правило — знижка або надбавка до ціни ночі, яка діє ПІСЛЯ надбавок за
 * заселеність (Ц30) і ДО зборів (`applyFees`). Умови: період (проживання —
 * по ночах; заїзду або виїзду — на всю поїздку), дні тижня, тарифи, типи,
 * тривалість, за скільки днів заброньовано (раннє бронювання / останній
 * момент), заселеність. Дія — мінус або плюс, відсотком від поточної ціни ночі
 * або сумою. Кілька правил застосовуються за пріоритетом (менше число —
 * раніше), кожне на результат попереднього.
 *
 * Промо — те саме правило з кодом: діє лише коли гість або оператор назвав
 * код, лічить використання, може бути «лише онлайн» (з форми бронювання).
 *
 * Чого тут НЕМАЄ навмисно:
 *   - вгадування дати бронювання: без `bookedAt` (канал, який сам ставить дату
 *     броні) правила «за N днів» не діють, а не «діють завжди»; у канал такі
 *     правила поїхали б як постійна ціна без щоденного пересилання на межі
 *     вікна (Ц3);
 *   - другого джерела ціни: правило множить або зсуває те, що вже назвав
 *     `priceNights()`, і жодного числа само не називає (інваріант 16, Ц7).
 */

export type RuleKind = 'rule' | 'promo';
export const RULE_KINDS: readonly RuleKind[] = ['rule', 'promo'];
export type RuleCondition = 'period_of_stay' | 'period_of_checkin' | 'period_of_checkout';
export const RULE_CONDITIONS: readonly RuleCondition[] = ['period_of_stay', 'period_of_checkin', 'period_of_checkout'];
export type RuleAction = 'decrease' | 'increase';
export const RULE_ACTIONS: readonly RuleAction[] = ['decrease', 'increase'];
export type RuleValueKind = 'percent' | 'fixed';
export const RULE_VALUE_KINDS: readonly RuleValueKind[] = ['percent', 'fixed'];
/** Звідки прийшла поїздка: форма бронювання, рецепція, менеджер каналів. */
export type SalesChannel = 'direct' | 'operator' | 'channel';

export interface PriceRule {
  id: string;
  name: string;
  /** Як назвати правило гостю в розкладі; порожньо — не показувати назви. */
  titleForGuest: string | null;
  kind: RuleKind;
  /** Промокод (лише `promo`); порівнюється без регістру. */
  code: string | null;
  /** NULL з датами — читається як період проживання. */
  conditionKind: RuleCondition | null;
  dateFrom: string | null;
  dateTo: string | null;
  /** Дні тижня 1–7 (1 — понеділок); NULL або порожньо — усі. */
  weekDays: readonly number[] | null;
  /** NULL — усі тарифи; список — лише ці (поїздка без тарифу під такий список не підходить). */
  ratePlanIds: readonly string[] | null;
  unitTypeIds: readonly string[] | null;
  minLos: number | null;
  maxLos: number | null;
  /** За скільки днів до заїзду заброньовано: from ≤ днів ≤ to; NULL — межі немає. */
  bookedDaysBeforeFrom: number | null;
  bookedDaysBeforeTo: number | null;
  /** Дорослі + діти. */
  occupancyFrom: number | null;
  occupancyTo: number | null;
  action: RuleAction;
  /** Додатне число: відсоток або сума. */
  value: number;
  valueKind: RuleValueKind;
  /** Менше — раніше. */
  priority: number;
  isActive: boolean;
  onlineOnly: boolean;
  maxUses: number | null;
  currentUses: number;
}

export interface StayContext {
  checkIn: string;
  nights: number;
  ratePlanId: string | null;
  unitTypeId: string;
  /** Дорослі + діти. */
  occupancy: number;
  /** Дата бронювання YYYY-MM-DD; NULL — невідома (канал), і EB/LM не діють. */
  bookedAt: string | null;
  channel: SalesChannel;
  promoCode: string | null;
}

export interface RuleDelta {
  ruleId: string;
  name: string;
  titleForGuest: string | null;
  kind: RuleKind;
  /** Зі знаком: знижка відʼємна. */
  delta: number;
}

/** День тижня дати, 1 = понеділок … 7 = неділя; розібрано як UTC, без поясу. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const dow = d.getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86400000);
}

function inWindow(rule: PriceRule, date: string): boolean {
  if (rule.dateFrom && date < rule.dateFrom) return false;
  if (rule.dateTo && date > rule.dateTo) return false;
  return true;
}

function onWeekDay(rule: PriceRule, date: string): boolean {
  if (!rule.weekDays || rule.weekDays.length === 0) return true;
  return rule.weekDays.includes(isoWeekday(date));
}

/** Умови, які вирішуються на рівні ПОЇЗДКИ — однаково для кожної її ночі. */
export function ruleAppliesToStay(rule: PriceRule, ctx: StayContext): boolean {
  if (!rule.isActive) return false;
  if (rule.kind === 'promo') {
    if (!rule.code || !ctx.promoCode) return false;
    if (rule.code.trim().toUpperCase() !== ctx.promoCode.trim().toUpperCase()) return false;
    if (rule.maxUses != null && rule.currentUses >= rule.maxUses) return false;
  }
  if (rule.onlineOnly && ctx.channel !== 'direct') return false;
  if (rule.ratePlanIds && rule.ratePlanIds.length > 0 && (ctx.ratePlanId == null || !rule.ratePlanIds.includes(ctx.ratePlanId))) return false;
  if (rule.unitTypeIds && rule.unitTypeIds.length > 0 && !rule.unitTypeIds.includes(ctx.unitTypeId)) return false;
  if (rule.minLos != null && ctx.nights < rule.minLos) return false;
  if (rule.maxLos != null && ctx.nights > rule.maxLos) return false;
  if (rule.occupancyFrom != null && ctx.occupancy < rule.occupancyFrom) return false;
  if (rule.occupancyTo != null && ctx.occupancy > rule.occupancyTo) return false;
  if (rule.bookedDaysBeforeFrom != null || rule.bookedDaysBeforeTo != null) {
    if (!ctx.bookedAt) return false;
    const days = daysBetween(ctx.bookedAt, ctx.checkIn);
    if (rule.bookedDaysBeforeFrom != null && days < rule.bookedDaysBeforeFrom) return false;
    if (rule.bookedDaysBeforeTo != null && days > rule.bookedDaysBeforeTo) return false;
  }
  if (rule.conditionKind === 'period_of_checkin') {
    if (!inWindow(rule, ctx.checkIn) || !onWeekDay(rule, ctx.checkIn)) return false;
  } else if (rule.conditionKind === 'period_of_checkout') {
    const checkOut = addDays(ctx.checkIn, ctx.nights);
    if (!inWindow(rule, checkOut) || !onWeekDay(rule, checkOut)) return false;
  }
  return true;
}

/** Умови поїздки плюс умови НОЧІ: період проживання і день тижня ночі. */
export function ruleAppliesToNight(rule: PriceRule, ctx: StayContext, date: string): boolean {
  if (!ruleAppliesToStay(rule, ctx)) return false;
  if (rule.conditionKind === 'period_of_checkin' || rule.conditionKind === 'period_of_checkout') return true;
  return inWindow(rule, date) && onWeekDay(rule, date);
}

function shift(rule: PriceRule, price: number): number {
  const raw = rule.valueKind === 'percent' ? price * (Number(rule.value) / 100) : Number(rule.value);
  return rule.action === 'decrease' ? -raw : raw;
}

/** Правила за пріоритетом; однаковий пріоритет — за назвою, щоб порядок не залежав від SQL. */
export function sortRules(rules: readonly PriceRule[]): PriceRule[] {
  return [...rules].sort((a, b) => (a.priority - b.priority) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * Ціна ночі після правил і розклад того, що спрацювало. Кожне правило — на
 * результат попереднього, з округленням `money()` на кожному кроці: саме це
 * число побачить гість у розкладі, і сума розкладу мусить збігтися з ціною.
 */
export function applyRules(rules: readonly PriceRule[], ctx: StayContext, date: string, nightPrice: number): { price: number; applied: RuleDelta[] } {
  let price = money(nightPrice);
  const applied: RuleDelta[] = [];
  for (const rule of sortRules(rules)) {
    if (!ruleAppliesToNight(rule, ctx, date)) continue;
    const next = money(Math.max(0, price + shift(rule, price)));
    const delta = money(next - price);
    if (delta === 0 && rule.value !== 0) { price = next; continue; }
    applied.push({ ruleId: rule.id, name: rule.name, titleForGuest: rule.titleForGuest, kind: rule.kind, delta });
    price = next;
  }
  return { price, applied };
}
