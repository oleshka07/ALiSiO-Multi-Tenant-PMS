/**
 * «Я щойно забронював на сторінці готелю» — що з цього випливає.
 *
 * ── Навіщо це взагалі ───────────────────────────────────────────────────
 *
 * Готель у фазі `external` продає через свій онлайн-модуль, і його бронь
 * прийде до нас дельтою за ≤ 15 хвилин. Але гість стоїть перед дверима
 * ЗАРАЗ, з валізою і телефоном, і сказати йому «поверніться за чверть
 * години» — це той самий порожній хол, від якого застосунок і мав позбавити.
 *
 * Тому заводиться ПОПЕРЕДНЯ бронь із ключем походження, а дельта її потім
 * знаходить і доповнює. Правило те саме, що в кіоску (КІ8) — задача та сама,
 * відрізняється лише пристрій у руках.
 *
 * ── Чому ключ саме такий ────────────────────────────────────────────────
 *
 * `winhotel-ob:<номер підтвердження>` — рівно те, що пише кіоск
 * (`apps/kiosk/api/walkin.handlers.ts`). Один вигляд ключа на обидва входи:
 * два різні означали б, що звірка мусить знати про обидва, а забути про
 * другий — найлегший спосіб дістати дубль броні.
 *
 * Функція живе тут, а не в кіоску, бо тепер її читають ДВОЄ. Кіоск лишає в
 * себе свою і далі — переносити його на цей файл означало б чіпати живий
 * термінал заради краси; натомість гейт стверджує, що обидві дають ОДНЕ
 * і те саме, і розійтись їм не дасть саме він.
 */

/** Ключ походження: те, за чим звірка знайде цю бронь. */
export function claimRef(confirmation: string): string {
  return `winhotel-ob:${confirmation.trim()}`;
}

export interface ClaimInput {
  confirmation: string;
  lastName: string;
  firstName: string;
  checkIn: string;
  checkOut: string;
  adults: number;
}

export type ClaimRefusal =
  | 'need_confirmation' | 'need_last_name' | 'need_check_in' | 'check_in_out_of_window';

/**
 * Форма заявки — або названа причина відмови.
 *
 * Номер підтвердження обовʼязковий, і це не прискіпливість: без нього
 * звірці нема за що вхопитись, і за чверть години в базі буде ДВІ броні на
 * одне перебування — одна наша порожня, друга справжня.
 *
 * Дати — у тому самому вікні, що й пошук: гість біля дверей заселяється
 * сьогодні-завтра, а не в липні. Вікно передається, а не береться тут, щоб
 * функція лишалась чистою і гейт міг назвати день сам.
 */
export function readClaim(
  raw: Record<string, unknown>,
  window: { from: string; to: string },
): { ok: true; claim: ClaimInput } | { ok: false; reason: ClaimRefusal } {
  const confirmation = String(raw.confirmation ?? '').trim();
  const lastName = String(raw.lastName ?? '').trim();
  const firstName = String(raw.firstName ?? '').trim();
  const checkIn = String(raw.checkIn ?? '').trim().slice(0, 10);
  const checkOut = String(raw.checkOut ?? '').trim().slice(0, 10);
  const adults = Math.max(1, Math.min(20, Number(raw.adults) || 1));

  if (!confirmation) return { ok: false, reason: 'need_confirmation' };
  if (!lastName) return { ok: false, reason: 'need_last_name' };
  if (!checkIn) return { ok: false, reason: 'need_check_in' };
  if (checkIn < window.from || checkIn > window.to) {
    return { ok: false, reason: 'check_in_out_of_window' };
  }

  // Виїзд, якого гість не назвав, — наступного дня. Це не вигадка про його
  // плани: бронь однаково перепишеться дельтою, а ніч без виїзду не існує в
  // жодному читачі наявності.
  const out = checkOut && checkOut > checkIn
    ? checkOut
    : new Date(new Date(`${checkIn}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

  return {
    ok: true,
    claim: { confirmation, lastName, firstName, checkIn, checkOut: out, adults },
  };
}

/** Ночей у заявці — рівно те, що між датами. */
export function claimNights(checkIn: string, checkOut: string): number {
  return Math.max(1, Math.round(
    (new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) / 86_400_000));
}
