/**
 * Як термінал у холі знаходить бронь — і чому не простіше.
 *
 * Чисті функції: жодного запиту. Сцени — `kiosk.check.ts`.
 *
 * ── Три звуження, і кожне закриває свій спосіб знайти чуже ──────────────
 *
 * Екран стоїть у холі, до нього підходить будь-хто, і він відповідає без
 * сесії. Пошук по одному полю тут — це довідник: «Мюллер, 14 березня» знає
 * кожен, хто бачив список гостей у Booking.com, а «є така бронь / немає»
 * саме по собі вже відповідь про людину.
 *
 *   ДВА ЧИННИКИ    — прізвище САМЕ ПО СОБІ не шукає нічого. Пари з §3.2:
 *                    прізвище + дата заїзду; номер підтвердження + прізвище;
 *                    телефон або пошта + дата;
 *   ЦЕЙ БУДИНОК    — корпус пристрою, не рахунок. Термінал у холі корпусу 1
 *                    не знаходить нічого в корпусі 2 (INC-029);
 *   ВІКНО ±1 ДЕНЬ  — заїзд або виїзд у межах «сьогодні ± доба». Бронь на
 *                    липень у березні на терміналі не існує: гість, який
 *                    приїде через пів року, нічого тут не робить, а от той,
 *                    хто хоче подивитись на чуже перебування, — робить.
 *
 * ── Виняток: QR ────────────────────────────────────────────────────────
 *
 * `guest_page_token` — це 64 шістнадцяткові символи, які гість дістав листом,
 * і саме ними без жодного другого чинника відчиняється весь гостьовий портал
 * (`/guest/<token>`). Вимагати біля нього ще й прізвища означало б, що на
 * терміналі та сама перепустка слабша, ніж у браузері гостя, — тобто зробити
 * QR-кнопку марною: гість сканує і однаково друкує.
 *
 * Тому токен рахується ДОСТАТНІМ сам по собі, а «завжди два чинники» з §3.2
 * стосується решти — усього, що можна вгадати або підглянути. Це відхилення
 * від букви задачі, і воно назване в звіті блоку.
 *
 * ── Кілька збігів ──────────────────────────────────────────────────────
 *
 * Список не показується НІКОЛИ: перелік «Мюллер А., Мюллер Б.» — це вже
 * розголошення. Замість нього — вимога третього чинника (`need_more`), і
 * скільки саме збігів знайшлося, теж не кажеться.
 */

/** Чинник — те, чим гість назвав себе. */
export type SearchFactor = 'token' | 'lastName' | 'checkIn' | 'confirmation' | 'phone' | 'email';

export interface SearchInput {
  token?: string | null;
  lastName?: string | null;
  checkIn?: string | null;
  confirmation?: string | null;
  phone?: string | null;
  email?: string | null;
}

const clean = (v: unknown): string => String(v ?? '').trim();

/** Які чинники справді названі. Порожній рядок — не чинник. */
export function namedFactors(input: SearchInput): SearchFactor[] {
  const out: SearchFactor[] = [];
  if (clean(input.token)) out.push('token');
  if (clean(input.lastName)) out.push('lastName');
  if (clean(input.checkIn)) out.push('checkIn');
  if (clean(input.confirmation)) out.push('confirmation');
  if (clean(input.phone)) out.push('phone');
  if (clean(input.email)) out.push('email');
  return out;
}

/**
 * Чи досить названого, щоб узагалі шукати.
 *
 * Токен — сам по собі; решта — не менше двох. Одного чинника мало НАВІТЬ
 * тоді, коли це номер підтвердження: §3.2 називає його в парі з прізвищем, і
 * номери в чужих системах бувають послідовними.
 */
export function enoughFactors(factors: SearchFactor[]): boolean {
  if (factors.includes('token')) return true;
  return factors.length >= 2;
}

/** Півінтервал вікна: `[сьогодні − 1, сьогодні + 1]`, включно з обома краями. */
export function stayWindow(today: string): { from: string; to: string } {
  const base = new Date(`${today}T00:00:00Z`).getTime();
  const day = (offset: number) => new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
  return { from: day(-1), to: day(1) };
}

/**
 * Чи потрапляє перебування у вікно терміналу.
 *
 * Заїзд АБО виїзд у межах ±1 дня: гість, який заїжджає завтра, і гість, який
 * виїжджає сьогодні, — обидва біля цього екрана. Перебування, що триває через
 * вікно наскрізь (заїхав тиждень тому, їде через тиждень), теж усередині: він
 * живе в готелі і замовляє послуги.
 */
export function inWindow(stay: { checkIn: string; checkOut: string }, window: { from: string; to: string }): boolean {
  const ci = stay.checkIn.slice(0, 10);
  const co = stay.checkOut.slice(0, 10);
  if (ci >= window.from && ci <= window.to) return true;
  if (co >= window.from && co <= window.to) return true;
  return ci < window.from && co > window.to;
}

export type SearchOutcome =
  | { kind: 'need_factors' }
  | { kind: 'need_more' }
  | { kind: 'not_found' }
  | { kind: 'found'; reservationId: string };

/**
 * Що відповісти на список збігів. Один — знайшли; більше — третій чинник;
 * жодного — «не знайдено» (і те саме слово на «такої броні немає» і на
 * «вона не цього будинку»: інваріант 5).
 */
export function decideSearch(matches: { id: string }[]): SearchOutcome {
  if (matches.length === 1) return { kind: 'found', reservationId: matches[0].id };
  if (matches.length > 1) return { kind: 'need_more' };
  return { kind: 'not_found' };
}

/**
 * Імʼя на екрані в холі — маскою.
 *
 * «Herr M…» замість «Herr Müller»: підтвердити гостю, що знайшли саме його,
 * можна й так, а от прочитати з-за спини повне прізвище чужої людини —
 * не можна. Порожнє імʼя лишається порожнім, а не стає крапками.
 */
export function maskName(value: string | null | undefined): string {
  const v = clean(value);
  if (!v) return '';
  const first = [...v][0];
  return `${first.toUpperCase()}…`;
}
