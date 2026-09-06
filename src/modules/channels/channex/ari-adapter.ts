/**
 * Черга → Channex: один прохід батчера по одному зʼєднанню, з боку вендора.
 *
 * Дзеркальний близнюк `catalog-adapter.ts` і `pull-adapter.ts`, тієї самої
 * форми `(connectionId, apiKey) => звіт`: тут складається ТОЙ БІК — клієнт,
 * дзеркало ідентифікаторів, переклад значень у тіло, — а порядок дій живе в
 * `domain/ari-batch.ts` і жодного слова звідси не бачить (інваріант И1).
 *
 * ── Що звідки береться ──────────────────────────────────────────────────
 *
 *   координати     — `cm_outbox` (захоплення з межею спроб)
 *   наявність      — `availabilityByDay()` з `@properties`, і ніщо інше (И3)
 *   ціна           — `priceNights()` з `@pricing`, по одній заселеності на
 *                    кожну ОПЦІЮ, яка існує на тому боці (И13, інваріант 16)
 *   адресати       — `cm_mappings`: тип за `unit_type`, тариф за ПАРОЮ
 *                    тип × тариф (Ц10), заселеності за `rate_plan_option`
 *   зсув           — `cm_connections.pricing_modifier_percent` (Ц7)
 *
 * ── Ніч закривається лише коли ціни немає на ЖОДНУ заселеність ─────────
 *
 * `stop_sell` — на тариф, не на опцію: закрити одну заселеність не можна.
 * До 05.09.2026 (Блок 0.6 B1) ціна, якої бракувало хоч на одну опцію,
 * закривала всю ніч пари — щоб не лишити решту опцій зі СТАРОЮ ціною на тому
 * боці (И2). Це правило перестало триматись разом із Ц26 (б): заселеність без
 * рядка матриці тепер — ніч БЕЗ ціни на цю кількість дорослих (інваріант 17),
 * а дзеркало досі памʼятає опції 1..max_adults з часів, коли каталог заводив
 * їх усі; живий `per_person` тариф із матрицею не на всі кількості закрився б
 * на всі ночі — після деплою й досилання 0067 одразу.
 *
 * Тепер у тіло йдуть лише опції, на які ціна є; опція без джерела не
 * згадується — вендор тримає на ній те, що мав; пара закривається лише коли
 * ціни немає на жодну опцію (закритий день, знятий тариф, ніч без базового
 * рядка). Каталог з 05.09 заводить у вендора лише опції з джерелом ціни, тож
 * у нових тарифів множина опцій і множина цін збігаються; опцію, заведену
 * раніше й без джерела, видно у звірці дзеркала (`channex-mappings-live.mjs`).
 *
 * ── Наявність і обмеження читаються ОДНИМ запитом на смугу ─────────────
 *
 * Домен питає по координаті; читати `availabilityByDay()` на кожну означало
 * б тисячу запитів на повний синк. Тому захоплення запамʼятовує межі дат,
 * а перше питання завантажує весь проміжок разом. Це деталь адаптера, і
 * контракт домену від неї не залежить.
 *
 * Проміжків ДВА — по одному на смугу, і кожен із захоплення СВОЄЇ смуги.
 * Один спільний, узятий із захоплення наявності, коштував INC-016
 * (03.09.2026): пачка з самих цінових координат — саме така, яку повертає
 * звірка або кладе правка мінімуму ночей у календарі, — читала обмеження
 * дня з порожнього проміжку, і `min_stay_arrival`, CTA/CTD, «закрито» не
 * потрапляли в тіло ніколи; коли ж наявність у пачці була, її проміжок
 * не покривав дат цін. Звірка при цьому рахувала очікуване зі своїм вікном
 * і чекала обмежень вічно.
 */
import { ChannexClient, ChannexError, ChannexPaused, type ChannexClientOptions, type ChannexEnvironment } from './client';
import { availabilityValues, rateValues, type IdMap, type PairMap } from './ari-payload';
import { connectionInTenant } from '../data/connections.repo';
import { connectionMirror } from '../data/mappings.repo';
import { claimBatch, markSent, releaseFailed, retireChanges } from '../data/outbox.repo';
import { recordSend, type SendSummary } from '../data/sends.repo';
import type { AriValue } from './ari-payload';
import { DEFAULT_MAX_ATTEMPTS, flushOutbox, type FlushDeps, type FlushReport, type NightSources } from '../domain/ari-batch.ts';
import type { AvailabilityChange, RateChange } from '../port';
import { availabilityByDay } from '@properties';
import { priceNights, dayRestrictions, pairRestrictionsAt, type DayRestrictions } from '@pricing';
import { money } from '@core/money';

/**
 * Скільки координат однієї смуги брати за прохід.
 *
 * Це не розмір пачки — пачку ріже домен за розміром тіла. Це лише стеля на
 * те, скільки рядків прочитати з черги за раз, щоб один прохід не тримав
 * захопленим пів року координат, поки шле першу пачку.
 */
const CLAIM_LIMIT = 5000;

export interface AriFlushOptions {
  /** Сьогодні, `YYYY-MM-DD` — для перевірок; дефолт системний. */
  today?: string;
  /** Межа спроб ЧЕРГИ (Ц14) — не плутати з повторами HTTP у `client`. */
  maxAttempts?: number;
  /**
   * Транспорт клієнта — для перевірки, яка ганяє СПРАВЖНІЙ клієнт із
   * підставленим `fetch`, що віддає автентичне тіло вендора (`429`,
   * `200` з `meta.warnings`). Це сходинка між заглушкою домену й живим
   * API: розбір помилки в клієнті і звільнення координати перевіряються
   * без жодного виклику до вендора. У бойовому шляху не передається.
   */
  client?: Pick<ChannexClientOptions, 'fetch' | 'baseUrl' | 'limiter' | 'sleep' | 'now' | 'maxAttempts'>;
}

/**
 * Невдача проходу чи рядка? Домен не знає вендора, тож каже адаптер: 429,
 * 5xx, власна пауза обмежувача і мережа — про прохід (спроба рядка не
 * рахується); 4xx з відмовою — про значення, і рахується.
 */
function markTransient(e: unknown): unknown {
  const transient = e instanceof ChannexPaused || !(e instanceof ChannexError) || e.retryable;
  if (e && typeof e === 'object') (e as { transient?: boolean }).transient = transient;
  return e;
}

/** Ціле в мінорних одиницях, без `* 100`: `1.005 * 100` це 100.49999999999999. */
export function minorOf(major: number): number {
  return money(Number(`${money(major)}e2`), 0);
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export const pairKey = (ratePlanId: string, unitTypeId: string) => `${ratePlanId}|${unitTypeId}`;

/** Ключі тіла, які адресують і датують, — не «поля» в сенсі журналу. */
const ADDRESS_KEYS = new Set(['property_id', 'room_type_id', 'rate_plan_id', 'date', 'date_from', 'date_to']);

/**
 * Що було в тілі — для журналу відправлень (Блок 0.5 п.4): ключі значень
 * (те, що звіряє контролер із таблицею тесту), наші координати й межі дат.
 * Рахується тут, а не в журналі: імена ключів — вендорські, і читати їх має
 * право лише адаптер (И1).
 */
export function summarizeSend(values: AriValue[], ours: (AvailabilityChange | RateChange)[]): SendSummary {
  const fields = new Set<string>();
  let from: string | null = null;
  let to: string | null = null;
  for (const v of values) {
    for (const k of Object.keys(v)) if (!ADDRESS_KEYS.has(k)) fields.add(k);
    const a = String(v.date_from ?? v.date ?? '');
    const b = String(v.date_to ?? v.date ?? '');
    if (a && (from === null || a < from)) from = a;
    if (b && (to === null || b > to)) to = b;
  }
  const unitTypeIds = [...new Set(ours.map((c) => c.unitTypeId))];
  const pairs = new Map<string, { ratePlanId: string; unitTypeId: string }>();
  for (const c of ours) {
    const rp = (c as RateChange).ratePlanId;
    if (rp) pairs.set(pairKey(rp, c.unitTypeId), { ratePlanId: rp, unitTypeId: c.unitTypeId });
  }
  return { fields: [...fields].sort(), unitTypeIds, pairs: [...pairs.values()], from, to };
}

/**
 * Дзеркало одного зʼєднання, прочитане для роботи: адресати обох смуг і
 * заселеності, які існують на тому боці. Спільне для розсилки й звірки (П6):
 * звірка мусить бачити ті самі опції, що й відправлення, — інакше вона
 * порівнювала б із тим, чого ніхто не слав.
 */
export interface MirrorContext {
  connection: NonNullable<Awaited<ReturnType<typeof connectionInTenant>>>;
  remotePropertyId: string;
  propertyId: string;
  /** Наш тип → їхній. */
  unitTypes: IdMap;
  mirroredUnitTypeIds: string[];
  /** Наша пара тип × тариф → їхній тариф (Ц10). */
  ratePlans: PairMap;
  /** Пара → заселеності, які існують на тому боці (И13). */
  occupancies: Map<string, number[]>;
  /** Опції заселеності того боку — ключі їхнього календаря (И13). */
  options: { remoteId: string; ratePlanId: string; unitTypeId: string; occupancy: number }[];
}

export async function mirrorContext(connectionId: string): Promise<MirrorContext> {
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('connection not found');
  // Без обʼєкта на тому боці адресувати нема куди — це шов із фазою 3, який
  // уже раз був порожнім (див. catalog-sync.check.ts), тому відмова, не пропуск.
  if (!connection.remotePropertyId) throw new Error('catalog not synced: the connection has no remote property yet');

  // ── Дзеркало: наше → їхнє ──────────────────────────────────────────────
  const mirror = await connectionMirror(connectionId);
  const unitTypes: IdMap = new Map(
    mirror.filter((m) => m.entityType === 'unit_type').map((m) => [m.localId, m.remoteId]),
  );
  const mirroredUnitTypeIds = [...new Set(mirror.filter((m) => m.entityType === 'unit_type').map((m) => m.localId))];
  const pairs = new Map(
    mirror.filter((m) => m.entityType === 'rate_plan').map((m) => [pairKey(m.localId, m.unitTypeId), m.remoteId]),
  );
  const ratePlans: PairMap = { get: (ratePlanId, unitTypeId) => pairs.get(pairKey(ratePlanId, unitTypeId)) };
  // Заселеності, які ІСНУЮТЬ на тому боці (И13): саме їх і цінуємо. Опція, якої
  // там немає, ціни не отримає; ціна, якої там не чекають, лягла б у нікуди.
  const occupancies = new Map<string, number[]>();
  const options: MirrorContext['options'] = [];
  for (const m of mirror) {
    if (m.entityType !== 'rate_plan_option' || m.occupancy <= 0) continue;
    const key = pairKey(m.localId, m.unitTypeId);
    occupancies.set(key, [...(occupancies.get(key) ?? []), m.occupancy]);
    options.push({ remoteId: m.remoteId, ratePlanId: m.localId, unitTypeId: m.unitTypeId, occupancy: m.occupancy });
  }
  return {
    connection, remotePropertyId: connection.remotePropertyId, propertyId: connection.propertyId,
    unitTypes, mirroredUnitTypeIds, ratePlans, occupancies, options,
  };
}

/** Смуга черги: наявність і ціни захоплюються, читаються й шлються окремо. */
export type Lane = 'availability' | 'rate';

/**
 * Джерела значень ночі — наявність, ціни по заселеностях, обмеження дня — з
 * одним читанням на проміжок. `spanOf(lane)` каже, який проміжок читати,
 * коли перше питання прийде: розсилка знає його після захоплення ЦІЄЇ смуги
 * (INC-016 — не сусідньої), звірка — одразу, один на обидві.
 */
export function nightSources(ctx: MirrorContext, spanOf: (lane: Lane) => { from: string; to: string } | null): NightSources {
  const { propertyId, occupancies, mirroredUnitTypeIds } = ctx;
  let freeByType: Map<string, Map<string, number>> | null = null;
  let restrictionsByDay: Map<string, DayRestrictions> | null = null;

  return {
    priceModifierPercent: ctx.connection.pricingModifierPercent,

    availabilityAt: async (unitTypeId, date) => {
      if (!freeByType) {
        const span = spanOf('availability');
        freeByType = span
          ? await availabilityByDay(propertyId, span.from, nextDay(span.to))
          : new Map();
      }
      // Типу немає серед тих, що мають номери, — `null`: продавати нічого.
      const byDay = freeByType.get(unitTypeId);
      if (!byDay) return null;
      return byDay.get(date) ?? 0;
    },

    // Обмеження дня — одним читанням на прохід, для всіх типів дзеркала
    // (Д1/Д2), у проміжку ЦІНОВОЇ смуги: саме її координати їх везуть.
    // Обмеження — ефективні для ПАРИ (Ц32 переглянуто 07.09): власний ключ
    // пари, де рядок пари має своє значення, інакше ключ типу.
    restrictionsAt: async (unitTypeId, date, ratePlanId) => {
      if (!restrictionsByDay) {
        const span = spanOf('rate');
        restrictionsByDay = span
          ? await dayRestrictions(mirroredUnitTypeIds, span.from, span.to)
          : new Map();
      }
      return pairRestrictionsAt(restrictionsByDay, unitTypeId, date, ratePlanId);
    },

    pricesAt: async (unitTypeId, ratePlanId, date) => {
      const wanted = occupancies.get(pairKey(ratePlanId, unitTypeId)) ?? [];
      if (wanted.length === 0) return null;
      const out: { occupancy: number; priceMinor: number }[] = [];
      for (const adults of wanted) {
        // Канал (Ц31): без дати бронювання й без промо — правила «за N днів»
        // і промокоди в канал не їдуть; правила за датою/днем тижня — їдуть.
        const quote = await priceNights({ unitTypeId, checkIn: date, nights: 1, adults, ratePlanId, channel: 'channel', bookedAt: null });
        const night = quote.nights[0];
        // Опція без джерела ціни випадає з тіла, пара не закривається (Блок
        // 0.6 B1). Див. шапку: закрита ніч — лише коли ціни немає на жодну.
        if (!night || quote.missing.length > 0) continue;
        out.push({ occupancy: adults, priceMinor: minorOf(night.price) });
      }
      return out.length ? out : null;
    },
  };
}

export async function ariFlush(
  connectionId: string,
  apiKey: string,
  options: AriFlushOptions = {},
): Promise<FlushReport> {
  const ctx = await mirrorContext(connectionId);
  const { connection, remotePropertyId, unitTypes, ratePlans } = ctx;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const client = new ChannexClient({
    apiKey,
    environment: connection.environment as ChannexEnvironment,
    ...(options.client ?? {}),
  });

  // ── Один запит на весь проміжок захоплених дат — на КОЖНУ смугу свій ──
  //
  // Наявність читається в проміжку наявності, обмеження дня — в проміжку
  // цін. Спільний проміжок від наявності лишав ціни без обмежень (INC-016).
  const spans: Record<Lane, { from: string; to: string } | null> = { availability: null, rate: null };
  const sources = nightSources(ctx, (lane) => spans[lane]);

  const deps: FlushDeps = {
    isEnabled: async () => connection.isEnabled,
    today: options.today,
    maxAttempts,
    ...sources,

    claim: async (kind) => {
      const rows = await claimBatch(connectionId, kind, CLAIM_LIMIT, maxAttempts);
      if (rows.length) {
        const starts = rows.map((r) => r.date).sort();
        const ends = rows.map((r) => r.dateTo ?? r.date).sort();
        spans[kind] = { from: starts[0], to: ends[ends.length - 1] };
      }
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        unitTypeId: r.unitTypeId ?? undefined,
        ratePlanId: r.ratePlanId ?? undefined,
        date: r.date,
        dateTo: r.dateTo ?? undefined,
        fields: r.fields,
        attempts: r.attempts,
      }));
    },

    // Кожен виклик — рядком журналу з тілом (Блок 0.5 п.4): і успішний із
    // розпискою, і відхилений зі статусом. Журнал не має права зламати
    // розсилку: його збій — у серверний лог, координати живуть своїм життям.
    send: async (kind, values) => {
      const body = kind === 'availability'
        ? availabilityValues(remotePropertyId, values as AvailabilityChange[], unitTypes)
        : rateValues(remotePropertyId, values as RateChange[], ratePlans);
      const log = async (status: number | null, taskId: string | null, error: string | null) => {
        if (body.values.length === 0) return; // нічого не пішло — нема що журналити
        try {
          await recordSend({
            connectionId, lane: kind, requestBody: { values: body.values }, responseStatus: status, taskId, error,
            rowsCount: body.values.length, summary: summarizeSend(body.values, values),
          });
        } catch (e) {
          console.error('cm_sends: failed to record a send', e);
        }
      };
      try {
        const answer = kind === 'availability'
          ? await client.publishAvailability(connectionId, body.values)
          : await client.publishRestrictions(connectionId, body.values);
        const receipt = answer.taskIds.join(',') || undefined;
        await log(200, receipt ?? null, answer.warnings.length ? `${answer.warnings.length} claim(s)` : null);
        return { warnings: answer.warnings, unmapped: body.unmapped, receipt };
      } catch (e) {
        const status = e instanceof ChannexError ? e.status : null;
        await log(status, null, String((e as Error)?.message ?? e));
        throw markTransient(e);
      }
    },

    markSent: (ids, receipt) => markSent(ids, receipt ?? null),
    release: (ids, reason, transient) => releaseFailed(ids, reason, transient),
    retire: (ids, reason) => retireChanges(ids, reason),
  };

  return flushOutbox(deps);
}
