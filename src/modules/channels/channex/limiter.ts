/**
 * Скільки повідомлень на хвилину можна слати — і кому саме належить ліміт.
 *
 * Документація Channex (API Rate Limits): «The limit is 20 ARI total per
 * minute… 10 Restrictions & Price Requests per minute **per property**,
 * 10 Availability Requests per minute **per property**».
 *
 * ГОЛОВНЕ СЛОВО ТУТ — «per property». Ліміт належить об'єкту, а не акаунту.
 * Глобальний лічильник був би зіпсований з обох боків одночасно: він душив
 * би десятий готель через активність першого (свої десять у нього є) і
 * водночас пропускав би забагато, коли один об'єкт шле пачку за пачкою.
 * Тому ключ тут — з'єднання (об'єкт), а не процес. Це інваріант И10.
 *
 * ДВІ СМУГИ, А НЕ ОДНА. Наявність і ціни рахуються окремо, по десять кожна.
 * Змішувати їх в один лічильник на двадцять означало б, що пачка цін з'їдає
 * квоту наявності — а наявність терміновіша: застаріле число продає номер,
 * якого немає. Channex і сам обробляє їх різними чергами («We push these
 * updates to the front of the queue for processing» — про наявність).
 *
 * ПАУЗА ПІСЛЯ ПОМИЛКИ. «If you hit any error you should pause updates for
 * the property for 1 minute and try again» — не лише після 429 і не лише
 * після 5xx. Будь-яка помилка означає, що об'єкт зараз краще не чіпати.
 *
 * Годинник передається ззовні, щоб перевірка не спала хвилинами: час — це
 * вхідні дані цього класу, а не його рішення.
 */

/** Смуга ліміту. Своя квота в кожної. */
export type Lane = 'availability' | 'rates';

export interface LimiterOptions {
  /** Скільки запитів у смузі на вікно. За замовчуванням — 10, як у Channex. */
  perWindow?: number;
  /** Довжина вікна, мс. За замовчуванням хвилина. */
  windowMs?: number;
  /** Пауза на весь об'єкт після будь-якої помилки. За замовчуванням хвилина. */
  pauseMs?: number;
  now?: () => number;
}

export type Verdict =
  | { ok: true }
  | { ok: false; retryAfterMs: number; reason: 'window' | 'paused' };

interface PropertyState {
  /** Час кожного відпущеного запиту в поточному вікні, по смугах. */
  sent: Record<Lane, number[]>;
  /** До якого моменту об'єкт на паузі. */
  pausedUntil: number;
}

export class ChannexRateLimiter {
  private readonly perWindow: number;
  private readonly windowMs: number;
  private readonly pauseMs: number;
  private readonly now: () => number;
  private readonly state = new Map<string, PropertyState>();

  constructor(options: LimiterOptions = {}) {
    this.perWindow = options.perWindow ?? 10;
    this.windowMs = options.windowMs ?? 60_000;
    this.pauseMs = options.pauseMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  private stateOf(key: string): PropertyState {
    let s = this.state.get(key);
    if (!s) this.state.set(key, (s = { sent: { availability: [], rates: [] }, pausedUntil: 0 }));
    return s;
  }

  /**
   * Чи можна слати зараз. Не блокує і нічого не чекає — просто відповідає.
   *
   * `take` записує факт відправлення, тож викликається один раз на запит.
   */
  take(key: string, lane: Lane): Verdict {
    const t = this.now();
    const s = this.stateOf(key);

    if (t < s.pausedUntil) {
      return { ok: false, retryAfterMs: s.pausedUntil - t, reason: 'paused' };
    }

    const cutoff = t - this.windowMs;
    const recent = s.sent[lane].filter((at) => at > cutoff);
    s.sent[lane] = recent;

    if (recent.length >= this.perWindow) {
      // Місце звільниться, коли з вікна випаде найстаріший запит.
      return { ok: false, retryAfterMs: recent[0] - cutoff, reason: 'window' };
    }

    recent.push(t);
    return { ok: true };
  }

  /**
   * Об'єкт на паузу: сталася помилка.
   *
   * `retryAfterMs` — якщо менеджер каналів сам сказав, скільки чекати.
   * Своє число не менше за його: коротша пауза — це той самий 429 ще раз.
   */
  pause(key: string, retryAfterMs?: number): void {
    const wait = Math.max(this.pauseMs, retryAfterMs ?? 0);
    const s = this.stateOf(key);
    s.pausedUntil = Math.max(s.pausedUntil, this.now() + wait);
  }

  /** Чи об'єкт зараз на паузі — для екрана стану, не для рішення. */
  pausedFor(key: string): number {
    const s = this.state.get(key);
    if (!s) return 0;
    return Math.max(0, s.pausedUntil - this.now());
  }

  /** Забути об'єкт: з'єднання видалили. */
  forget(key: string): void {
    this.state.delete(key);
  }
}
