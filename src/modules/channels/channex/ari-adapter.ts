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
 * ── Ніч, у якої є ціна не на всі заселеності, ЗАКРИВАЄТЬСЯ ──────────────
 *
 * `stop_sell` — на тариф, не на опцію: закрити одну заселеність не можна.
 * Послати ж лише ті заселеності, на які ціна є, означало б лишити решту зі
 * СТАРОЮ ціною на тому боці — тобто продати за числом, якого готель зараз не
 * називає (И2, інваріант 17). Тому ціна, якої бракує хоч на одну опцію,
 * закриває всю ніч цього тарифу на цьому типі. Строго — і навмисно: тиха
 * стара ціна гірша за закриту ніч.
 *
 * ── Наявність читається ОДНИМ запитом на прохід ─────────────────────────
 *
 * Домен питає по координаті; читати `availabilityByDay()` на кожну означало
 * б тисячу запитів на повний синк. Тому захоплення запамʼятовує межі дат,
 * а перше питання завантажує весь проміжок разом. Це деталь адаптера, і
 * контракт домену від неї не залежить.
 */
import { ChannexClient, ChannexError, ChannexPaused, type ChannexClientOptions, type ChannexEnvironment } from './client';
import { availabilityValues, rateValues, type IdMap, type PairMap } from './ari-payload';
import { connectionInTenant } from '../data/connections.repo';
import { connectionMirror } from '../data/mappings.repo';
import { claimBatch, markSent, releaseFailed, retireChanges } from '../data/outbox.repo';
import { DEFAULT_MAX_ATTEMPTS, flushOutbox, type FlushDeps, type FlushReport, type NightSources } from '../domain/ari-batch.ts';
import type { AvailabilityChange, RateChange } from '../port';
import { availabilityByDay } from '@properties';
import { priceNights, dayRestrictions, type DayRestrictions } from '@pricing';
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

/**
 * Джерела значень ночі — наявність, ціни по заселеностях, обмеження дня — з
 * одним читанням на проміжок. `spanOf` каже, який проміжок читати, коли
 * перше питання прийде: розсилка знає його після захоплення, звірка — одразу.
 */
export function nightSources(ctx: MirrorContext, spanOf: () => { from: string; to: string } | null): NightSources {
  const { propertyId, occupancies, mirroredUnitTypeIds } = ctx;
  let freeByType: Map<string, Map<string, number>> | null = null;
  let restrictionsByDay: Map<string, DayRestrictions> | null = null;

  return {
    priceModifierPercent: ctx.connection.pricingModifierPercent,

    availabilityAt: async (unitTypeId, date) => {
      if (!freeByType) {
        const span = spanOf();
        freeByType = span
          ? await availabilityByDay(propertyId, span.from, nextDay(span.to))
          : new Map();
      }
      // Типу немає серед тих, що мають номери, — `null`: продавати нічого.
      const byDay = freeByType.get(unitTypeId);
      if (!byDay) return null;
      return byDay.get(date) ?? 0;
    },

    // Обмеження дня — одним читанням на прохід, для всіх типів дзеркала (Д1/Д2).
    restrictionsAt: async (unitTypeId, date) => {
      if (!restrictionsByDay) {
        const span = spanOf();
        restrictionsByDay = span
          ? await dayRestrictions(mirroredUnitTypeIds, span.from, span.to)
          : new Map();
      }
      return restrictionsByDay.get(`${unitTypeId}|${date}`) ?? null;
    },

    pricesAt: async (unitTypeId, ratePlanId, date) => {
      const wanted = occupancies.get(pairKey(ratePlanId, unitTypeId)) ?? [];
      if (wanted.length === 0) return null;
      const out: { occupancy: number; priceMinor: number }[] = [];
      for (const adults of wanted) {
        const quote = await priceNights({ unitTypeId, checkIn: date, nights: 1, adults, ratePlanId });
        const night = quote.nights[0];
        // Бракує хоч однієї заселеності — ніч закривається цілком. Див. шапку.
        if (!night || quote.missing.length > 0) return null;
        out.push({ occupancy: adults, priceMinor: minorOf(night.price) });
      }
      return out;
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

  // ── Наявність — один запит на весь проміжок захоплених дат ────────────
  let span: { from: string; to: string } | null = null;
  const sources = nightSources(ctx, () => span);

  const deps: FlushDeps = {
    isEnabled: async () => connection.isEnabled,
    today: options.today,
    maxAttempts,
    ...sources,

    claim: async (kind) => {
      const rows = await claimBatch(connectionId, kind, CLAIM_LIMIT, maxAttempts);
      if (kind === 'availability' && rows.length) {
        const starts = rows.map((r) => r.date).sort();
        const ends = rows.map((r) => r.dateTo ?? r.date).sort();
        span = { from: starts[0], to: ends[ends.length - 1] };
      }
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        unitTypeId: r.unitTypeId ?? undefined,
        ratePlanId: r.ratePlanId ?? undefined,
        date: r.date,
        dateTo: r.dateTo ?? undefined,
        attempts: r.attempts,
      }));
    },

    send: async (kind, values) => {
      try {
        if (kind === 'availability') {
          const body = availabilityValues(remotePropertyId, values as AvailabilityChange[], unitTypes);
          const answer = await client.publishAvailability(connectionId, body.values);
          return { warnings: answer.warnings, unmapped: body.unmapped, receipt: answer.taskIds.join(',') || undefined };
        }
        const body = rateValues(remotePropertyId, values as RateChange[], ratePlans);
        const answer = await client.publishRestrictions(connectionId, body.values);
        return { warnings: answer.warnings, unmapped: body.unmapped, receipt: answer.taskIds.join(',') || undefined };
      } catch (e) {
        throw markTransient(e);
      }
    },

    markSent: (ids, receipt) => markSent(ids, receipt ?? null),
    release: (ids, reason, transient) => releaseFailed(ids, reason, transient),
    retire: (ids, reason) => retireChanges(ids, reason),
  };

  return flushOutbox(deps);
}
