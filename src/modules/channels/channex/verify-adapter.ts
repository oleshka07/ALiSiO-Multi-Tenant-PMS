/**
 * Звірка П6 з боку вендора: прочитати календар назад і порівняти з відправленим.
 *
 *   node src/modules/channels/channex/verify-adapter.check.ts
 *
 * Той самий близнюк, що `ari-adapter.ts`: тут складається ТОЙ БІК — клієнт,
 * мапа опцій, тлумачення чужих полів, — а порівняння і рішення «що назад у
 * чергу» живуть у `domain/verify.ts` і жодного чужого імені не бачать (И1).
 *
 * ── Чому саме так ───────────────────────────────────────────────────────
 *
 *   очікуване     — ТИМ САМИМ кодом, що й відправлення: `nightSources()` і
 *                   `resolveRateNight()`/`resolveAvailabilityNight()`. Друга
 *                   копія правил розійшлась би з першою мовчки.
 *   прочитане     — `GET /restrictions` одним викликом на вікно; ключ
 *                   відповіді — ОПЦІЯ ЗАСЕЛЕНОСТІ, не тариф (И13). Звірка,
 *                   яка шукала б наші `rate_plan_id` навпростець, загубила б
 *                   усі неосновні заселеності й доповіла «збігається».
 *   наявність     — у тій самій відповіді, спільна для всіх опцій типу:
 *                   читається через будь-яку опцію будь-якої пари цього типу.
 *   молоде        — вендор кладе задачі асинхронно; відправлене менш як
 *                   хвилину тому не звіряється, а рахується як «ще
 *                   застосовується». Інакше звірка одразу після натискання
 *                   повертала б у чергу те, що ще не встигло лягти.
 *   горизонт      — 90 ночей від сьогодні: один запит на клік, не пів року.
 *   розбіжне      — координата назад у чергу з причиною (`last_error`,
 *                   префікс `verify:`); наступний прохід шле ПОТОЧНЕ значення.
 *   не віддане    — поле чи ніч, яких у відповіді немає, — «не звірено», і
 *                   це названо у звіті, а не проковтнуто (інваріант 28).
 */
import { ChannexClient, type ChannexClientOptions, type ChannexEnvironment } from './client';
import { mirrorContext, nightSources, pairKey, minorOf } from './ari-adapter';
import { nightsOf, resolveAvailabilityNight, resolveRateNight } from '../domain/ari-batch.ts';
import {
  verifyNights, coordinatesToRequeue,
  type ExpectedNight, type RemoteNight, type SendsVerification,
} from '../domain/verify.ts';
import { recentSends, enqueueChange } from '../data/outbox.repo';
import { getSql } from '@core/db/async';

/** Скільки ночей уперед звіряється одним кліком. */
export const VERIFY_HORIZON_DAYS = 90;
/** Молодше — «ще застосовується», не звіряється. */
export const DEFAULT_MIN_AGE_SECONDS = 60;

export interface VerifyOptions {
  /** Скільки останніх відправлень узяти. */
  limit?: number;
  /** Вікно застосування вендора; живий прохід ставить нуль, бо сам чекає на збіг. */
  minAgeSeconds?: number;
  /** Сьогодні, `YYYY-MM-DD` — для перевірок; дефолт системний. */
  today?: string;
  /** Годинник — для перевірок. */
  now?: () => number;
  /** Транспорт клієнта — для перевірки зі справжнім клієнтом і підставленим `fetch`. */
  client?: Pick<ChannexClientOptions, 'fetch' | 'baseUrl' | 'limiter' | 'sleep' | 'now' | 'maxAttempts'>;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Вік відправлення в секундах. `CURRENT_TIMESTAMP` SQLite — `YYYY-MM-DD
 * HH:MM:SS` в UTC без позначки зони; Postgres може віддати `Date`. Рядок
 * без зони читається як UTC, інакше локальна зона сервера зсунула б вік на
 * години і «молоде» стало б «старим» або навпаки.
 */
export function ageSeconds(sentAt: string | Date, nowMs: number): number {
  const ms = sentAt instanceof Date
    ? sentAt.getTime()
    : Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(sentAt) ? sentAt : `${sentAt.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? (nowMs - ms) / 1000 : Number.POSITIVE_INFINITY;
}

/** Чужа клітинка календаря → доменна ніч. Чого немає — `undefined`, не вигадане. */
export function readCell(cell: Record<string, unknown>): RemoteNight {
  const num = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const bool = (v: unknown): boolean | undefined => {
    if (v === undefined || v === null) return undefined;
    return v === true || v === 1 || v === '1' || v === 'true';
  };
  const out: RemoteNight = {};
  const free = num(cell.availability);
  if (free !== undefined) out.free = free;
  // Ціна приходить рядком `"1500.00"` (INVENTORY §5.2) — у мінорні цілі тим
  // самим `minorOf`, що й на відправленні: копійка в копійку, без float.
  if ('rate' in cell) {
    const rate = num(cell.rate);
    out.rateMinor = rate === undefined ? null : minorOf(rate);
  }
  const closed = bool(cell.stop_sell);
  if (closed !== undefined) out.closed = closed;
  // Шлемо `min_stay_arrival` явно (INC-015: віртуальне `min_stay` обʼєкт із
  // `min_stay_type = both` ігнорує — а такими наш майстер обʼєкти й
  // заводить), тож і назад читаємо поле заїзду. `min_stay_through` — інше
  // обмеження, його ми не стверджуємо; читати його першим означало б
  // вічно повертати в чергу координату, яка вже доїхала.
  const minStay = num(cell.min_stay_arrival) ?? num(cell.min_stay);
  if (minStay !== undefined) out.minStay = minStay;
  const maxStay = num(cell.max_stay);
  if (maxStay !== undefined) out.maxStay = maxStay;
  const noArrival = bool(cell.closed_to_arrival);
  if (noArrival !== undefined) out.noArrival = noArrival;
  const noDeparture = bool(cell.closed_to_departure);
  if (noDeparture !== undefined) out.noDeparture = noDeparture;
  return out;
}

export async function verifySends(
  connectionId: string,
  apiKey: string,
  options: VerifyOptions = {},
): Promise<SendsVerification> {
  const ctx = await mirrorContext(connectionId);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const nowMs = options.now?.() ?? Date.now();
  const minAge = options.minAgeSeconds ?? DEFAULT_MIN_AGE_SECONDS;
  const horizon = addDays(today, VERIFY_HORIZON_DAYS);

  const sends = await recentSends(connectionId, options.limit ?? 50);
  const report: SendsVerification = {
    checked: 0, matched: 0, mismatches: [], unverified: [],
    sends: sends.length, fresh: 0, beyond: 0, requeued: 0, window: null,
  };

  // ── Які ночі звіряємо: з відправлень, що вже мали лягти, у горизонті ───
  const wantAvailability = new Map<string, { unitTypeId: string; date: string }>();
  const wantRate = new Map<string, { unitTypeId: string; ratePlanId: string; date: string }>();
  for (const s of sends) {
    if (ageSeconds(s.sentAt, nowMs) < minAge) { report.fresh++; continue; }
    if (!s.unitTypeId) continue;
    const from = s.date < today ? today : s.date;
    const to = s.dateTo ?? s.date;
    if (to < from) continue;
    for (const date of nightsOf(from, to)) {
      if (date > horizon) { report.beyond++; continue; }
      if (s.kind === 'availability') {
        wantAvailability.set(`${s.unitTypeId}|${date}`, { unitTypeId: s.unitTypeId, date });
      } else if (s.ratePlanId) {
        wantRate.set(`${s.ratePlanId}|${s.unitTypeId}|${date}`, { unitTypeId: s.unitTypeId, ratePlanId: s.ratePlanId, date });
      }
    }
  }
  // Ніч ціни звіряється разом із наявністю свого типу — з тієї самої
  // клітинки. Живе 02.09.2026: поки наявність типу на тому боці нуль, вендор
  // тримає `stop_sell: true` попри наш `false` із ціною; знімає його
  // наявність, не прапорець. Звірка лише прапорця повертала б ціну в чергу
  // вічно, а лікує тут відправлення наявності.
  for (const n of wantRate.values()) {
    const key = `${n.unitTypeId}|${n.date}`;
    if (!wantAvailability.has(key)) wantAvailability.set(key, { unitTypeId: n.unitTypeId, date: n.date });
  }
  const dates = [...wantAvailability.values(), ...wantRate.values()].map((n) => n.date).sort();
  if (dates.length === 0) return report;
  const window = { from: dates[0], to: dates[dates.length - 1] };
  report.window = window;

  // ── Очікуване — тим самим кодом, що й відправлення ─────────────────────
  const sources = nightSources(ctx, () => window);
  const expected: ExpectedNight[] = [];
  for (const n of wantAvailability.values()) {
    if (!ctx.unitTypes.get(n.unitTypeId)) continue; // незмаплений тип — про нього нічого не йшло
    const v = await resolveAvailabilityNight(sources, n.unitTypeId, n.date);
    expected.push({ kind: 'availability', unitTypeId: n.unitTypeId, date: n.date, free: v.free });
  }
  for (const n of wantRate.values()) {
    if (!ctx.ratePlans.get(n.ratePlanId, n.unitTypeId)) continue; // незмаплена пара — так само
    const occupancies = ctx.occupancies.get(pairKey(n.ratePlanId, n.unitTypeId)) ?? [];
    const v = await resolveRateNight(sources, n.unitTypeId, n.ratePlanId, n.date);
    for (const occupancy of occupancies) {
      const price = v.prices?.find((p) => p.occupancy === occupancy);
      expected.push({
        kind: 'rate', unitTypeId: n.unitTypeId, ratePlanId: n.ratePlanId, occupancy, date: n.date,
        rateMinor: price ? price.priceMinor : null,
        closed: v.closed === true,
        ...(v.minStay !== undefined ? { minStay: v.minStay } : {}),
        ...(v.maxStay !== undefined ? { maxStay: v.maxStay } : {}),
        ...(v.noArrival !== undefined ? { noArrival: v.noArrival } : {}),
        ...(v.noDeparture !== undefined ? { noDeparture: v.noDeparture } : {}),
      });
    }
  }

  // ── Прочитане — один виклик на вікно ───────────────────────────────────
  const client = new ChannexClient({
    apiKey,
    environment: ctx.connection.environment as ChannexEnvironment,
    ...(options.client ?? {}),
  });
  const calendar = await client.readRestrictions(apiKey, ctx.remotePropertyId, window.from, window.to);

  // Мапа опцій (И13): наша пара × заселеність → їхній ключ календаря.
  // Наявність типу спільна для всіх його опцій — береться з першої, у якої
  // ця ніч є; порядок опцій у дзеркалі нічого не означає.
  const optionOf = new Map<string, string>();
  const optionsOfType = new Map<string, string[]>();
  for (const o of ctx.options) {
    optionOf.set(`${o.ratePlanId}|${o.unitTypeId}|${o.occupancy}`, o.remoteId);
    optionsOfType.set(o.unitTypeId, [...(optionsOfType.get(o.unitTypeId) ?? []), o.remoteId]);
  }
  const cellOf = (key: string | undefined, date: string) => {
    const cell = key ? calendar[key]?.[date] : undefined;
    return cell && typeof cell === 'object' ? cell : undefined;
  };
  const remote = (e: ExpectedNight): RemoteNight | null => {
    const cell = e.kind === 'availability'
      ? (optionsOfType.get(e.unitTypeId) ?? []).map((key) => cellOf(key, e.date)).find(Boolean)
      : cellOf(optionOf.get(`${e.ratePlanId}|${e.unitTypeId}|${e.occupancy}`), e.date);
    if (!cell) return null;
    const night = readCell(cell);
    // Нуль наявності на тому боці панує над прапорцем: «закрито» тоді не
    // стверджує нічого про наш прапорець, а розбіжність наявності (якщо є)
    // названа поруч і веде до правильного лікування — див. вище.
    if (e.kind === 'rate' && night.free === 0) delete night.closed;
    return night;
  };

  const result = verifyNights(expected, remote);
  report.checked = result.checked;
  report.matched = result.matched;
  report.mismatches = result.mismatches;
  report.unverified = result.unverified;

  // ── Розбіжне — назад у чергу з причиною ────────────────────────────────
  const sql = getSql();
  for (const c of coordinatesToRequeue(result.mismatches)) {
    await enqueueChange(sql, connectionId, { kind: c.kind, unitTypeId: c.unitTypeId, ratePlanId: c.ratePlanId, date: c.date }, c.reason);
    report.requeued++;
  }
  return report;
}
