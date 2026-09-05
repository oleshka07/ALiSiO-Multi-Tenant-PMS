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
import { ChannexRateLimiter, sharedChannexLimiter, type Lane } from './limiter';
import type { AriValue } from './ari-payload';
import type { ChannexRevision } from './revision-map';

export type ChannexEnvironment = 'staging' | 'production';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Спостерігач відповідей — для живих скриптів, що зберігають зразки.
 *
 * Інваріант 28 (AGENTS §3): поле чужої відповіді, від якого залежить код,
 * має бути побачене в живій відповіді хоч раз. Живий прохід ставить сюди
 * записувач (`scripts/lib/channex-samples.mjs`), і кожна відповідь вендора —
 * успішна чи ні — лягає зразком у `docs/vendor/channex/live/`; реєстр полів
 * `live-fields.json` звіряється з ними гейтом `check-live-fields`.
 * У застосунку сюди ніхто не ставить нічого: відповіді не журналюються.
 */
export interface ChannexResponseSample {
  method: HttpMethod;
  path: string;
  status: number;
  payload: unknown;
}
export type ChannexResponseSink = (sample: ChannexResponseSample) => void;

let responseSink: ChannexResponseSink | null = null;

export function setChannexResponseSink(sink: ChannexResponseSink | null): void {
  responseSink = sink;
}

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

/** Одна сторінка стрічки ревізій. */
export interface RevisionPage {
  /** Ревізії, вже витягнені з конвертів JSON:API. */
  revisions: ChannexRevision[];
  /** Скільки всього непідтверджених — за словами сервера. */
  total: number;
  page: number;
  limit: number;
}

/**
 * Скільки записів просити на сторінку.
 *
 * Максимум API — 100 («Max `limit` value is 100», API Reference); більше
 * відхиляється з 400. Просимо саме максимум: типова сторінка — 10, тобто
 * готель із півсотнею броней за ніч читався б шістьма викликами замість
 * одного.
 */
const FEED_PAGE_LIMIT = 100;

/**
 * Скільки сторінок дочитувати за один прохід.
 *
 * Стеля тут не оптимізація, а різниця між повільним кроном і процесом, який
 * не завершується ніколи: стрічка віддає лише НЕПІДТВЕРДЖЕНІ ревізії, тож
 * сервер, який з будь-якої причини завжди відповідає «є ще», закрутив би
 * цикл назавжди. 20 × 100 = 2000 ревізій за прохід — на два порядки більше
 * за все, що бачить готель за ніч; недочитане візьме наступний прохід.
 */
const FEED_MAX_PAGES = 20;

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
    // Спільний на процес, бо бюджет належить обʼєкту, не проходу. Власний
    // годинник (перевірки) означає власний обмежувач — інакше він не тікав би.
    this.limiter = options.limiter
      ?? (options.now ? new ChannexRateLimiter({ now: options.now }) : sharedChannexLimiter());
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
   * Чи справжній ключ — одним найдешевшим читанням, одразу після вставки.
   *
   * `true`/`false` — відповідь вендора про КЛЮЧ (`401`). Усе інше (простій,
   * мережа, 5xx після повторів) кидає: «вендор лежить» не можна показати
   * готельєру як «ключ неправильний» — він піде шукати помилку у власному
   * кабінеті. Список обʼєктів акаунта — дозволене читання (інваріант 25).
   */
  async probeKey(apiKey: string): Promise<boolean> {
    try {
      await this.requestAs(apiKey, 'GET', '/properties?pagination[limit]=1');
      return true;
    } catch (e) {
      if (e instanceof ChannexError && (e.status === 401 || e.status === 403)) return false;
      throw e;
    }
  }

  /**
   * Адреса вбудованого вікна `/channels` — з разовим токеном, скутим ТУТ.
   *
   * Ключ API у браузер не потрапляє: токен просить сервер, і лише токен іде
   * в адресу. Токен живе 15 хвилин, спалюється при першому використанні, у
   * базу не пишеться і в журнал не потрапляє (`channel-iframe.md`).
   * `username` — хто з нашого боку відкрив вікно; вендор пише його в свій
   * журнал, а працює користувач під тим, ЧИЙ ключ (обмеження документації).
   */
  async channelsFrameUrl(
    apiKey: string,
    remotePropertyId: string,
    options: { username: string; lng?: string },
  ): Promise<string> {
    const payload = await this.requestAs(apiKey, 'POST', '/auth/one_time_token', {
      one_time_token: { property_id: remotePropertyId, username: options.username },
    });
    const token = (payload.data as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || !token) {
      throw new ChannexError(502, 'no_token', 'One-time token missing in the response');
    }
    const server = this.baseUrl.replace(/\/api\/v1$/, '');
    const query = new URLSearchParams({
      oauth_session_key: token,
      app_mode: 'headless',
      redirect_to: '/channels',
      property_id: remotePropertyId,
    });
    if (options.lng) query.set('lng', options.lng);
    return `${server}/auth/exchange?${query.toString()}`;
  }

  /**
   * Канали обʼєкта разом із тим, які тарифи на них змаплені — звірка Ц8.
   *
   * `filter[property_id]` обовʼязковий: без нього список іде по ВСЬОМУ
   * акаунту (И11). `rate_plans` — мапінг-айтеми `{id, rate_plan_id}`,
   * порожні, поки зʼєднання не змаплене; `is_active` — «Disabled
   * connections do not send updates to the channel».
   */
  async listChannels(
    apiKey: string,
    remotePropertyId: string,
  ): Promise<{ id: string; title: string; isActive: boolean; remoteRatePlanIds: string[] }[]> {
    const payload = await this.requestAs(apiKey, 'GET', `/channels?filter[property_id]=${encodeURIComponent(remotePropertyId)}`);
    const data = Array.isArray(payload.data) ? (payload.data as Record<string, any>[]) : [];
    return data.map((row) => ({
      id: String(row.id),
      title: String(row.attributes?.title ?? ''),
      isActive: Boolean(row.attributes?.is_active),
      remoteRatePlanIds: (Array.isArray(row.attributes?.rate_plans) ? row.attributes.rate_plans : [])
        .map((m: { rate_plan_id?: unknown }) => String(m.rate_plan_id ?? '')).filter(Boolean),
    }));
  }

  /**
   * Канали обʼєкта СИРИМИ — для дзеркала рівня OTA (К2).
   *
   * `listChannels` вище віддає зведення для звірки Ц8 і навмисно відкидає все
   * зайве: назву коду адаптера, налаштування підключення, ідентифікатори
   * мапінг-айтемів. Дзеркалу потрібне саме воно — на екрані стоїть «який це
   * OTA» і «що там продається», — тож тут відповідь віддається як є, а
   * тлумачить її `channels-adapter.ts` (И1: чужі імена не виходять звідси).
   *
   * `filter[property_id]` обовʼязковий: без нього список іде по ВСЬОМУ
   * акаунту, тобто по всіх наших готелях разом (межа И11).
   */
  async listChannelsRaw(apiKey: string, remotePropertyId: string): Promise<Record<string, unknown>[]> {
    const payload = await this.requestAs(apiKey, 'GET',
      `/channels?filter[property_id]=${encodeURIComponent(remotePropertyId)}`);
    return Array.isArray(payload.data) ? payload.data as Record<string, unknown>[] : [];
  }

  /**
   * Каталог адаптерів каналів — «доступні OTA» на екрані.
   *
   * Належить вендору, не обʼєкту: фільтра тут немає й бути не може. Не
   * зберігається — копія переліку, який росте, протухла б так само, як
   * протухла б копія налаштувань каналу (§4.3).
   */
  async listChannelAdapters(apiKey: string): Promise<Record<string, unknown>[]> {
    const payload = await this.requestAs(apiKey, 'GET', '/channels/list');
    return Array.isArray(payload.data) ? payload.data as Record<string, unknown>[] : [];
  }

  /**
   * Календар обʼєкта назад — для звірки (П6, ari.md «Get Availability Or
   * Restrictions Per Rate Plan»).
   *
   * Ключ верхнього рівня — ідентифікатор ОПЦІЇ ЗАСЕЛЕНОСТІ, не тарифу
   * (INVENTORY §4.5, И13); ідентифікатор тарифу адресує лише основну
   * заселеність. Наявність лежить у тій самій відповіді, спільна для всіх
   * опцій типу. `filter[property_id]` обовʼязковий — це межа орендаря в
   * рядку запиту, як у стрічки (И11). Читання не витрачає бюджет ARI:
   * ліміт вендора — на повідомлення, і `take` тут не кличеться.
   *
   * Повертається сира мапа `data[option][date] = { … }`: чужі імена полів
   * тлумачить адаптер, і лише він (И1).
   */
  async readRestrictions(
    apiKey: string,
    remotePropertyId: string,
    from: string,
    to: string,
  ): Promise<Record<string, Record<string, Record<string, unknown>>>> {
    const fields = 'availability,rate,stop_sell,min_stay_arrival,min_stay_through,max_stay,closed_to_arrival,closed_to_departure';
    const payload = await this.requestAs(apiKey, 'GET',
      `/restrictions?filter[property_id]=${encodeURIComponent(remotePropertyId)}`
      + `&filter[date][gte]=${encodeURIComponent(from)}&filter[date][lte]=${encodeURIComponent(to)}`
      + `&filter[restrictions]=${fields}`);
    const data = payload.data;
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, Record<string, Record<string, unknown>>>)
      : {};
  }

  // ── Вебхуки обʼєкта (webhook-collection.md) ─────────────────────────────
  //
  // Усі ходять через `call(key, …)`: бюджет обʼєкта один (И10), а реєстрація
  // у вендора — той самий рахунок, що й ARI. `model` — Models.WebhookWriteModel
  // дослівно: `property_id`, `callback_url`, `event_mask`, `headers`,
  // `is_active`, `send_data`. Два останні за замовчуванням `false` — вебхук
  // без явного `is_active: true` існує і мовчить.

  async createWebhook(key: string, model: Record<string, unknown>): Promise<{ id: string; attributes: Record<string, unknown> }> {
    const payload = await this.call(key, 'POST', '/webhooks', { webhook: model });
    const data = payload.data as { id?: unknown; attributes?: Record<string, unknown> } | undefined;
    if (!data || typeof data.id !== 'string' || !data.id) {
      throw new ChannexError(502, 'no_webhook_id', 'Webhook id missing in the response');
    }
    return { id: data.id, attributes: data.attributes ?? {} };
  }

  /** Атрибути вебхука, прочитані назад. `null` — вендор його не має (404). */
  async getWebhook(key: string, webhookId: string): Promise<Record<string, unknown> | null> {
    try {
      const payload = await this.call(key, 'GET', `/webhooks/${encodeURIComponent(webhookId)}`);
      const data = payload.data as { attributes?: Record<string, unknown> } | undefined;
      return data?.attributes ?? null;
    } catch (e) {
      if (e instanceof ChannexError && e.status === 404) return null;
      throw e;
    }
  }

  async updateWebhook(key: string, webhookId: string, model: Record<string, unknown>): Promise<void> {
    await this.call(key, 'PUT', `/webhooks/${encodeURIComponent(webhookId)}`, { webhook: model });
  }

  /** `true` — був і видалений; `false` — вендор уже не мав (404), і це не помилка. */
  async deleteWebhook(key: string, webhookId: string): Promise<boolean> {
    try {
      await this.call(key, 'DELETE', `/webhooks/${encodeURIComponent(webhookId)}`);
      return true;
    } catch (e) {
      if (e instanceof ChannexError && e.status === 404) return false;
      throw e;
    }
  }

  /**
   * `POST /webhooks/test`: вендор сам стукає в `callback_url` і повертає код
   * і тіло, які побачив. Читання назад для И27 без справжньої броні.
   */
  async testWebhook(key: string, model: Record<string, unknown>): Promise<{ statusCode: number; body: string }> {
    const payload = await this.call(key, 'POST', '/webhooks/test', { webhook: model });
    // Живий API віддає `status`; документація обіцяє `status_code` (виміряно
    // 02.09.2026, §15 ТЗ). Читається лише бачене живим (інваріант 28) — поле
    // з документації, якого вендор не віддає, дало б 0 і не впало б.
    return { statusCode: Number(payload.status ?? 0), body: String(payload.body ?? '') };
  }

  /**
   * Один виклик ЧУЖИМ ключем — не тим, з яким збудовано клієнт.
   *
   * Майстер перевіряє ключ, якого ще не збережено, і кує токен ключем
   * готелю; будувати окремий клієнт на кожен — зайве. Повтори ті самі, що
   * в `call`, паузи по обʼєкту немає: обʼєкт тут ще не відомий.
   */
  private async requestAs(
    apiKey: string,
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.request(method, path, body, apiKey);
      } catch (e) {
        const isChannex = e instanceof ChannexError;
        const transient = !isChannex || e.retryable;
        if (transient && attempt < this.maxAttempts) {
          await this.sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        throw e;
      }
    }
    throw new Error('channex: unreachable');
  }

  /**
   * Одна сторінка стрічки непідтверджених ревізій.
   *
   * ДВІ ДРІБНИЦІ В РЯДКУ ЗАПИТУ, КОЖНА З ЦІНОЮ.
   *
   * `filter[property_id]` — це межа орендаря, винесена в query string. Один
   * ключ API обслуговує всі готелі акаунта, тож стрічка без фільтра віддає
   * ревізії ВСІХ об'єктів одним списком: броні чужого орендаря приїхали б у
   * транзакцію цього. Тому об'єкт тут обов'язковий аргумент, а не опція.
   *
   * `order[inserted_at]=asc` — типовий порядок не той, і його треба просити
   * (документація каже це окремою підказкою). Дві ревізії одного бронювання,
   * застосовані навпаки, дають скасовану бронь як активну.
   */
  async fetchBookingRevisions(
    key: string,
    propertyId: string,
    options: { page?: number; limit?: number } = {},
  ): Promise<RevisionPage> {
    const query = new URLSearchParams({
      'filter[property_id]': propertyId,
      'order[inserted_at]': 'asc',
      'pagination[page]': String(options.page ?? 1),
      'pagination[limit]': String(options.limit ?? FEED_PAGE_LIMIT),
    });

    const payload = await this.read(key, `/booking_revisions/feed?${query}`);

    // Кожен запис — конверт JSON:API `{ type, id, attributes }`, і корисне
    // лежить у `attributes`. Віддати конверт як є означало б дати маперу
    // об'єкт без жодного знайомого поля: кожна ревізія стала б «зіпсованою»,
    // стрічка — порожньою, і жодної помилки при цьому не сталося б.
    const data = Array.isArray(payload.data) ? (payload.data as { attributes?: unknown }[]) : [];
    const meta = (payload.meta ?? {}) as { total?: number; page?: number; limit?: number };

    return {
      revisions: data
        .map((d) => (d && typeof d === 'object' && 'attributes' in d ? d.attributes : d))
        .filter((r): r is ChannexRevision => !!r && typeof r === 'object'),
      total: Number(meta.total ?? data.length),
      page: Number(meta.page ?? 1),
      limit: Number(meta.limit ?? FEED_PAGE_LIMIT),
    };
  }

  /**
   * Уся стрічка, скільки її є — сторінка за сторінкою, у порядку надходження.
   *
   * Читати лише першу сторінку означає в завантажений день мовчки загубити
   * одинадцяту броню: помилки немає, звіт зелений, гість не заїде. Тому
   * дочитуємо — але зі стелею (`FEED_MAX_PAGES`), бо стрічка самоочищається
   * підтвердженнями, а не читанням: сервер, який завжди каже «є ще», інакше
   * закрутив би крон назавжди.
   *
   * Дочитування ЙДЕ ДО першого підтвердження, а не впереміш із ним: інакше
   * кожен ack зсував би вікно під ногами й сторінки перескакували б через
   * записи.
   */
  async fetchAllBookingRevisions(
    key: string,
    propertyId: string,
    options: { maxPages?: number; limit?: number } = {},
  ): Promise<ChannexRevision[]> {
    const maxPages = options.maxPages ?? FEED_MAX_PAGES;
    const limit = options.limit ?? FEED_PAGE_LIMIT;
    const all: ChannexRevision[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const got = await this.fetchBookingRevisions(key, propertyId, { page, limit });
      all.push(...got.revisions);
      // Порожня або неповна сторінка означає, що це була остання. `total`
      // не використовуємо як єдину ознаку: він рахує стан на момент запиту,
      // а стрічка живе — між сторінками могло і додатись, і зникнути.
      if (got.revisions.length < limit) break;
    }

    return all;
  }

  /**
   * Підтвердити прийом ревізії.
   *
   * `revisionId` — це `id` ревізії, а НЕ її `system_id`. Обидва унікальні на
   * ревізію, тож помилка не помітна з нашого боку: підтвердження просто
   * летить у нікуди (404), ревізія назавжди лишається в стрічці, а готель
   * кожні 30 хвилин отримує лист `non_acked_booking`.
   *
   * Викликається ТІЛЬКИ після коміту транзакції (інваріант И5).
   */
  async ackBookingRevision(key: string, revisionId: string): Promise<void> {
    await this.call(key, 'POST', `/booking_revisions/${encodeURIComponent(revisionId)}/ack`, {});
  }

  /**
   * Каталог: створити обʼєкт, тип номера, тариф.
   *
   * ── Чому не в смузі ARI ─────────────────────────────────────────────
   *
   * Ліміт 10+10 на хвилину належить оновленням наявності й цін. Каталог —
   * інший рід виклику: він трапляється раз при підключенні, а не щохвилини,
   * і рахувати його в ту саму квоту означало б, що підключення нового
   * готелю душить розсилку цін наявних. Повтори при цьому ті самі.
   *
   * ── Тіло загорнуте ключем сутності ──────────────────────────────────
   *
   * `{"property": {…}}`, `{"room_type": {…}}`, `{"rate_plan": {…}}` — так
   * вимагає API, і без обгортки він відповідає порожньою валідацією, у якій
   * не видно жодного поля.
   */
  async createProperty(key: string, attributes: Record<string, unknown>): Promise<string> {
    const payload = await this.call(key, 'POST', '/properties', { property: attributes });
    return idOf(payload, 'property');
  }

  async createRoomType(key: string, attributes: Record<string, unknown>): Promise<string> {
    const payload = await this.call(key, 'POST', '/room_types', { room_type: attributes });
    return idOf(payload, 'room_type');
  }

  /**
   * Тариф і його опції заселеності.
   *
   * Повертаються ОБИДВА: id тарифу і id кожної опції. Опції потрібні окремо,
   * бо живий календар індексований саме ними, а не тарифом (INVENTORY §4.5);
   * id неосновних опцій не повертаються більше ніде.
   *
   * Порядок `options` у відповіді — НЕ той, у якому їх надіслали, і не за
   * заселеністю: спершу основна, далі решта як вийде. Тому зіставляємо за
   * полем `occupancy`, а не за позицією.
   */
  async createRatePlan(
    key: string,
    attributes: Record<string, unknown>,
  ): Promise<{ id: string; options: { occupancy: number; id: string }[] }> {
    const payload = await this.call(key, 'POST', '/rate_plans', { rate_plan: attributes });
    const data = (payload.data ?? {}) as { id?: string; attributes?: Record<string, unknown> };
    const id = idOf(payload, 'rate_plan');
    const raw = Array.isArray(data.attributes?.options) ? data.attributes.options : [];

    const options = (raw as Record<string, unknown>[])
      .map((o) => ({ occupancy: Number(o.occupancy), id: String(o.id ?? '') }))
      .filter((o) => Number.isFinite(o.occupancy) && o.id !== '');

    return { id, options };
  }

  /**
   * Читання: ті самі повтори, але БЕЗ квоти ARI.
   *
   * Ліміт 10+10 на хвилину належить оновленням ARI. Порахувати читання
   * стрічки в ту саму смугу означало б, що жвавий обмін бронями душить
   * оновлення цін — і навпаки, пачка цін перестає пускати броні в готель.
   *
   * З тієї ж причини читання не ставить об'єкт на паузу, коли здається:
   * помилка стрічки нічого не каже про ARI, а зайва пауза зупинила б
   * розсилку цін через непов'язане. Виняток — `429`: це прямий сигнал
   * сервера, і його поважаємо.
   */
  private read(key: string, path: string): Promise<Record<string, unknown>> {
    return this.call(key, 'GET', path);
  }

  private async call(
    key: string,
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.request(method, path, body);
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

        throw e;
      }
    }

    throw new Error('channex: unreachable');
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
    const payload = await this.request('POST', path, body);

    const meta = (payload.meta ?? {}) as { warnings?: ChannexWarning[] };
    const data = Array.isArray(payload.data) ? (payload.data as { id?: string }[]) : [];

    return {
      taskIds: data.map((d) => d.id).filter((id): id is string => typeof id === 'string'),
      warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
    };
  }

  /**
   * Один HTTP-виклик і розбір конверта. Спільний для читання й запису.
   *
   * Розбір саме тут, а не в кожного викликача: інваріант И4 («200 OK ще не
   * означає, що застосувалось») тримається на тому, що конверт `errors`
   * читають ЗАВЖДИ, а не там, де про нього згадали.
   */
  private async request(
    method: HttpMethod,
    path: string,
    body?: unknown,
    apiKey: string = this.apiKey,
  ): Promise<Record<string, unknown>> {
    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        // Саме так, малими літерами й через дефіс — як в API Reference.
        'user-api-key': apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = text ? JSON.parse(text) : {};
      responseSink?.({ method, path, status: response.status, payload });
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

    return payload;
  }
}

/**
 * Ідентифікатор створеної сутності з конверта JSON:API.
 *
 * Відсутній id — це відмова, а не «створилось без id»: далі за ним
 * адресується все інше, і порожній рядок у дзеркалі означав би мапінг у
 * нікуди. Інваріант 13 у мініатюрі.
 */
function idOf(payload: Record<string, unknown>, what: string): string {
  const data = payload.data as { id?: unknown } | undefined;
  const id = data && typeof data === 'object' ? data.id : undefined;
  if (typeof id !== 'string' || id === '') {
    throw new ChannexError(200, 'no_id', `${what} created without an id`, payload);
  }
  return id;
}

/** `Retry-After` Channex не документує, але поважаємо, якщо прийде. */
function retryAfterMsOf(e: ChannexError): number | undefined {
  const d = e.details;
  if (typeof d === 'number') return d * 1000;
  return undefined;
}
