/**
 * Розмова з Channex по HTTP: ключ, конверт, помилки, відступ.
 *
 * Єдине місце, яке знає слово `channex`, заголовок `user-api-key` і форму
 * відповіді. Вище за течією все це вже доменне (`../port.ts`).
 *
 * ТРИ РЕЧІ, ЯКІ ТУТ ЛЕГКО ЗРОБИТИ НЕПРАВИЛЬНО:
 *
 * 1. `200 OK` НЕ ОЗНАЧАЄ, ЩО ЩОСЬ ЗАСТОСУВАЛОСЬ. Документація ARI подає
 *    відповідь із помилками валідації під заголовком «Validation Error
 *    Response — Status Code: 200 OK», з тілом
 *    `{"data": [], "meta": {"message": "Success", "warnings": [ … ]}}`.
 *    Пояснення там же: «one message can be rejected, but another will be
 *    successfully produced» — тобто застосування ЧАСТКОВЕ. Порожній `data`
 *    означає, що не створено жодної задачі, тобто не застосовано нічого.
 *    Клієнт, який дивиться лише на код відповіді, мовчки втрачає ціни, і
 *    канал продовжує продавати за старими. Це інваріант И4.
 *
 * 2. Помилка — це привід зупинитися по ОБ'ЄКТУ, а не по процесу. «If you
 *    hit any error you should pause updates for the property for 1 minute»
 *    (Rate Limits). Пауза живе в `limiter.ts` і ключується з'єднанням.
 *
 * 3. Повторювати можна не все. `429` і `5xx` — тимчасові, їх варто
 *    повторити з наростанням. `400` і `401` повторювати немає сенсу:
 *    вдруге буде те саме, а спроби з'їдять квоту об'єкта.
 *
 * `fetch`, годинник і сон передаються ззовні: перевірка мусить ганяти цей
 * клієнт по-справжньому, але не спати хвилинами.
 */
import { ChannexRateLimiter, type Lane } from './limiter';
import type { AriValue } from './ari-payload';

export type ChannexEnvironment = 'staging' | 'production';

const BASE_URL: Record<ChannexEnvironment, string> = {
  staging: 'https://staging.channex.io/api/v1',
  production: 'https://app.channex.io/api/v1',
};

export interface ChannexClientOptions {
  apiKey: string;
  environment?: ChannexEnvironment;
  /** Перекриває середовище — для мок-сервера в перевірці. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  limiter?: ChannexRateLimiter;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Скільки разів пробувати тимчасову помилку, разом із першою спробою. */
  maxAttempts?: number;
}

/** Претензія до одного значення, як її повернув Channex. */
export interface ChannexWarning {
  rate_plan_id?: string;
  room_type_id?: string;
  date?: string;
  date_from?: string;
  date_to?: string;
  warning?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface AriResponse {
  /** Ідентифікатори задач. Порожньо — не застосовано нічого. */
  taskIds: string[];
  warnings: ChannexWarning[];
}

/**
 * Помилка, на яку Channex відповів конвертом `errors`.
 *
 * `e.message` НЕ ЙДЕ КЛІЄНТУ (інваріант 6) — це текст для журналу.
 */
export class ChannexError extends Error {
  // Поля оголошені явно, а не параметрами конструктора: node виконує ці
  // файли зі зрізанням типів, і parameter properties там не працюють.
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly details?: unknown;

  constructor(status: number, code: string, title: string, details?: unknown) {
    super(`channex ${status} ${code}: ${title}`);
    this.name = 'ChannexError';
    this.status = status;
    this.code = code;
    this.title = title;
    this.details = details;
  }

  /** Тимчасова: варто повторити. Постійна: вдруге буде те саме. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Об'єкт на паузі — слати зараз не можна, і це не помилка мережі. */
export class ChannexPaused extends Error {
  readonly retryAfterMs: number;
  readonly reason: 'window' | 'paused';

  constructor(retryAfterMs: number, reason: 'window' | 'paused') {
    super(`channex throttled: ${reason}, retry in ${retryAfterMs}ms`);
    this.name = 'ChannexPaused';
    this.retryAfterMs = retryAfterMs;
    this.reason = reason;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ChannexClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly limiter: ChannexRateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;

  constructor(options: ChannexClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? BASE_URL[options.environment ?? 'staging']).replace(/\/$/, '');
    this.doFetch = options.fetch ?? globalThis.fetch;
    this.limiter = options.limiter ?? new ChannexRateLimiter({ now: options.now });
    this.sleep = options.sleep ?? defaultSleep;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  /**
   * Скільки номерів вільно.
   *
   * `key` — з'єднання (об'єкт), яким ключується ліміт. Не ключ API: один
   * ключ обслуговує всі готелі акаунта, а квота в кожного своя.
   */
  publishAvailability(key: string, values: AriValue[]): Promise<AriResponse> {
    return this.postAri(key, 'availability', '/availability', values);
  }

  /** Ціни й обмеження. Окреме повідомлення — так вимагає Channex. */
  publishRestrictions(key: string, values: AriValue[]): Promise<AriResponse> {
    return this.postAri(key, 'rates', '/restrictions', values);
  }

  /**
   * ЯК ТУТ ВЛАШТОВАНИЙ ВІДСТУП, І ЧОМУ САМЕ ТАК.
   *
   * Спокуса — повторити будь-яку помилку через секунду. Для `429` це рівно
   * те, чого Channex просить не робити: «pause updates for the property for
   * 1 minute and try again». Повтор через секунду після «забагато запитів»
   * дає ще один `429` і з'їдає квоту, яка й так вичерпана.
   *
   * Тому дві різні реакції:
   *
   *   429           → об'єкт на хвилину, БЕЗ негайного повтору. Рядки
   *                   лишаються в черзі, наступний прохід крона їх візьме.
   *   5xx / мережа  → коротке наростання тут-таки (1с, 2с, 4с): це блимання,
   *                   і чекати через нього хвилину — марно втрачений час.
   *                   Не допомогло — тоді об'єкт на паузу.
   *   400 / 401     → не повторюємо: вдруге буде те саме. Об'єкт усе одно
   *                   на паузу, як просить документація, — але головне тут
   *                   те, що помилка одразу стає видимою.
   *
   * Пауза ставиться ЛИШЕ коли ми здаємось. Поставити її перед внутрішнім
   * повтором означало б, що повтор ніколи не станеться: лімітер сам себе й
   * зупинить.
   */
  private async postAri(
    key: string,
    lane: Lane,
    path: string,
    values: AriValue[],
  ): Promise<AriResponse> {
    // Порожню пачку не шлемо: Channex відповів би претензією «at least one
    // restriction should be present», і ми б витратили квоту на нічого.
    if (values.length === 0) return { taskIds: [], warnings: [] };

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const verdict = this.limiter.take(key, lane);
      if (!verdict.ok) throw new ChannexPaused(verdict.retryAfterMs, verdict.reason);

      try {
        return await this.send(path, { values });
      } catch (e) {
        const isChannex = e instanceof ChannexError;

        if (isChannex && e.status === 429) {
          this.limiter.pause(key, retryAfterMsOf(e));
          throw e;
        }

        const transient = !isChannex || e.retryable;
        if (transient && attempt < this.maxAttempts) {
          await this.sleep(1000 * 2 ** (attempt - 1));
          continue;
        }

        this.limiter.pause(key);
        throw e;
      }
    }

    throw new Error('channex: unreachable');
  }

  private async send(path: string, body: unknown): Promise<AriResponse> {
    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Саме так, малими літерами й через дефіс — як в API Reference.
        'user-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      // Не JSON — це не відповідь API, а щось перед ним: балансувальник,
      // сторінка помилки, проксі. Текст у журнал, назовні — загальне.
      throw new ChannexError(response.status, 'invalid_json', 'Response was not JSON', text.slice(0, 500));
    }

    const errors = payload.errors as { code?: string; title?: string; details?: unknown } | undefined;
    if (errors) {
      throw new ChannexError(
        response.status,
        errors.code ?? 'unknown',
        errors.title ?? 'Unknown error',
        errors.details,
      );
    }

    if (!response.ok) {
      // Код помилки без конверта `errors` — теж помилка, і мовчати про неї
      // не можна лише тому, що тіло виявилось не тієї форми.
      throw new ChannexError(response.status, 'http_error', `HTTP ${response.status}`, text.slice(0, 500));
    }

    const meta = (payload.meta ?? {}) as { warnings?: ChannexWarning[] };
    const data = Array.isArray(payload.data) ? (payload.data as { id?: string }[]) : [];

    return {
      taskIds: data.map((d) => d.id).filter((id): id is string => typeof id === 'string'),
      warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
    };
  }
}

/** `Retry-After` Channex не документує, але поважаємо, якщо прийде. */
function retryAfterMsOf(e: ChannexError): number | undefined {
  const d = e.details;
  if (typeof d === 'number') return d * 1000;
  return undefined;
}
