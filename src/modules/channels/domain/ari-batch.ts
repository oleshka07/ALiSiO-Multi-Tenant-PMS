import type { AvailabilityChange, RateChange } from '../port';

/**
 * Що поїде в канал із черги — і що станеться, коли не поїде.
 *
 *   node src/modules/channels/domain/ari-batch.check.ts
 *
 * Порядок дій, а не розмова з вендором: імені менеджера каналів тут немає й
 * бути не може (інваріант И1). «Взяти координати, дізнатись поточні значення,
 * скласти повідомлення, відправити, позначити» — однаково в будь-якого.
 *
 * ── Черга тримає КООРДИНАТУ, значення читається зараз ───────────────────
 *
 * Рядок `cm_outbox` каже «наявність типу X на дату D змінилась», і не каже,
 * на скільки. Число береться з джерела в момент відправлення. Інакше два
 * записи в чергу за 40 секунд дали б дві відправки з різними числами, і яке
 * доїде останнім — питання порядку в черзі, а не стану готелю.
 *
 * ── ТРИ ПРАВИЛА, КОЖНЕ З ЯКИХ КОШТУЄ, ЯКЩО ЙОГО ПОРУШИТИ ───────────────
 *
 * **1. Помилка ЗВІЛЬНЯЄ захоплення.** Рядок із виставленим `claimed_at` і
 * порожнім `sent_at` не забере вже ніхто: він не видний ні як відправлений,
 * ні як такий, що чекає. Зміна не поїде НІКОЛИ — та сама катастрофа, від
 * якої будувалась черга (0054), тільки заходить вона через шлях помилки.
 * Вендор просить після будь-якої помилки зупинити оновлення обʼєкта на
 * хвилину і повторити з наростанням; пауза живе в обмежувачі, а повернення
 * рядка — тут.
 *
 * **2. Кожна координата розвʼязується в ОДНЕ З ДВОХ: «ціни + відкрито» або
 * «закрито».** Ніколи в «не слати нічого». Тиха ніч зі старою ціною гірша за
 * закриту: канал продовжує продавати за числом, якого готель більше не
 * називає, і дізнаються про це з рахунку гостя (И2, інваріант 17).
 *
 * Відкриття мусить бути ЯВНИМ. Прапорець `stop_sell` у шапці тарифу липкий:
 * виміряно на живому API 01.09.2026 — тариф, створений закритим, після
 * успішної відправки ціни лишився закритим. Батчер, який шле саму лише ціну,
 * лишає весь заведений каталог закритим назавжди, і помилки при цьому немає
 * ніде (И14).
 *
 * **3. Пачка ріжеться за РОЗМІРОМ тіла, не за кількістю рядків.** Ліміт
 * вендора — 10 МБ на виклик, а кількість значень усередині не обмежена:
 * повний синк на 500 днів це ДВА виклики, не тисяча. Різати за рядками
 * означає або слати вдесятеро більше викликів, ніж треба, або одного разу
 * впертись у межу тілом, зібраним із «безпечної» кількості рядків.
 *
 * ── Смуги нарізно, і наявність перша ────────────────────────────────────
 *
 * Наявність і ціни — окремі повідомлення, і це не наша примха: у вендора в
 * них різні відра ліміту (по 10 на хвилину на обʼєкт кожне), і наявність має
 * власний, швидший шлях на їхньому боці. Наявність іде першою, бо застаріла
 * наявність продає номер, якого немає, а застаріла ціна — це лише
 * неправильні гроші.
 *
 * Провал однієї смуги не забирає з собою другу: інакше перша ж помилка в
 * цінах спиняла б наявність, тобто найтерміновіше.
 */

/** Координата з черги. Значення в ній немає навмисно — див. шапку. */
export interface ClaimedCoordinate {
  id: string;
  kind: 'availability' | 'rate';
  unitTypeId?: string;
  ratePlanId?: string;
  date: string;
}

/** Значення, зібране з джерела, разом із рядками черги, які його породили. */
interface Resolved<T> {
  ids: string[];
  value: T;
}

export interface FlushReport {
  /** Скільки координат поїхало. */
  sent: number;
  /** Скільки повернулось у чергу. */
  failed: number;
  /** Скільки викликів зроблено — те, що витрачає квоту обʼєкта. */
  calls: number;
  /** Причини повернення, по одній на смугу. */
  errors: string[];
}

export interface FlushDeps {
  /** Захопити координати однієї смуги. Порожньо — нема чого слати. */
  claim(kind: 'availability' | 'rate'): Promise<ClaimedCoordinate[]>;
  /**
   * Скільки вільно на цю дату. `null` — типу вже немає.
   *
   * Нуль і `null` тут означають те саме для каналу: продавати нічого. Це не
   * вигадане число — тип, якого не існує, справді не має вільних номерів, і
   * промовчати про нього означало б лишити канал продавати неіснуюче.
   */
  availabilityAt(unitTypeId: string, date: string): Promise<number | null>;
  /**
   * Ціни по заселеностях на цю дату. `null` — ціни немає.
   *
   * `null` це НЕ нуль і не порожній масив: ніч, яку не покриває жодне
   * джерело, закривається (інваріант 17). Порожній масив прочитався б як
   * «цін не міняли», і ніч поїхала б зі старою ціною.
   */
  pricesAt(ratePlanId: string, date: string): Promise<{ occupancy: number; priceMinor: number }[] | null>;
  /** Відправити одне повідомлення. Кидає на помилці; `warnings` — теж помилка. */
  send(
    kind: 'availability' | 'rate',
    values: (AvailabilityChange | RateChange)[],
  ): Promise<{ warnings: unknown[] }>;
  markSent(ids: string[]): Promise<void>;
  release(ids: string[], reason: string): Promise<void>;
  /** Стеля тіла одного виклику. Дефолт — 10 МБ вендора з запасом. */
  maxBodyBytes?: number;
  /**
   * Скільки важить одне значення.
   *
   * Домен не знає, у що адаптер його загорне, тож міряє власну серіалізацію —
   * це НИЖНЯ оцінка справжнього тіла. Тому дефолтна стеля з запасом, а
   * адаптер, який знає точний формат, може передати свою функцію.
   */
  sizeOf?(value: AvailabilityChange | RateChange): number;
}

/** 10 МБ вендора мінус запас на конверт і на різницю доменного й чужого тіла. */
const DEFAULT_MAX_BODY = 8 * 1024 * 1024;

const jsonSize = (value: unknown): number => JSON.stringify(value).length;

/**
 * Розкласти значення на пачки за розміром.
 *
 * Значення, більше за стелю саме по собі, їде ОКРЕМОЮ пачкою, а не
 * відкидається і не чекає: інакше воно не поїде ніколи — та сама вічність,
 * що з незвільненим захопленням, тільки тихіша.
 */
function intoBatches<T>(items: Resolved<T>[], max: number, sizeOf: (v: T) => number): Resolved<T>[][] {
  const batches: Resolved<T>[][] = [];
  let current: Resolved<T>[] = [];
  let size = 0;

  for (const item of items) {
    const own = sizeOf(item.value);
    if (current.length > 0 && size + own > max) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += own;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Один прохід батчера по одній смузі.
 *
 * Повертає, скільки поїхало і скільки повернулось. Кидати назовні нема чого:
 * друга смуга мусить піти незалежно від долі першої.
 */
async function flushLane<T extends AvailabilityChange | RateChange>(
  kind: 'availability' | 'rate',
  resolved: Resolved<T>[],
  deps: FlushDeps,
  report: FlushReport,
): Promise<void> {
  if (resolved.length === 0) return;

  const max = deps.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const sizeOf = deps.sizeOf ?? jsonSize;

  for (const batch of intoBatches(resolved, max, sizeOf as (v: T) => number)) {
    const ids = batch.flatMap((r) => r.ids);
    try {
      const answer = await deps.send(kind, batch.map((r) => r.value));
      // `200 OK` з непорожніми претензіями — це помилка, а не успіх (И4).
      // Порожній результат означає, що не застосовано НІЧОГО, тож позначити
      // рядки відправленими означало б втратити зміну, доповівши про успіх.
      if (answer.warnings && answer.warnings.length > 0) {
        await deps.release(ids, `warnings: ${JSON.stringify(answer.warnings).slice(0, 300)}`);
        report.failed += ids.length;
        report.errors.push(`${kind}: ${answer.warnings.length} claim(s)`);
      } else {
        await deps.markSent(ids);
        report.sent += ids.length;
      }
    } catch (e: any) {
      // Найважливіші два рядки в усьому файлі — див. правило 1 у шапці.
      await deps.release(ids, String(e?.message ?? e));
      report.failed += ids.length;
      report.errors.push(`${kind}: ${e?.message ?? e}`);
    }
    report.calls++;
  }
}

/**
 * Взяти з черги все, що чекає, і відправити.
 *
 * Викликається ВСЕРЕДИНІ контексту орендаря: черга, джерела значень і
 * дзеркало читаються в його межах.
 */
export async function flushOutbox(deps: FlushDeps): Promise<FlushReport> {
  const report: FlushReport = { sent: 0, failed: 0, calls: 0, errors: [] };

  // ── Наявність ────────────────────────────────────────────────────────
  const availability = await deps.claim('availability');
  const resolvedAvailability: Resolved<AvailabilityChange>[] = [];
  for (const c of availability) {
    if (!c.unitTypeId) continue;
    const free = await deps.availabilityAt(c.unitTypeId, c.date);
    resolvedAvailability.push({
      ids: [c.id],
      value: { unitTypeId: c.unitTypeId, date: c.date, free: free ?? 0 },
    });
  }
  await flushLane('availability', resolvedAvailability, deps, report);

  // ── Ціни й обмеження ─────────────────────────────────────────────────
  const rates = await deps.claim('rate');
  const resolvedRates: Resolved<RateChange>[] = [];
  for (const c of rates) {
    if (!c.ratePlanId) continue;
    const prices = await deps.pricesAt(c.ratePlanId, c.date);
    // Правило 2 з шапки, і воно тут ціле в двох рядках: або ціни та явне
    // відкриття, або закриття. Третього — «не слати» — немає.
    resolvedRates.push(prices && prices.length
      ? { ids: [c.id], value: { ratePlanId: c.ratePlanId, date: c.date, prices, closed: false } }
      : { ids: [c.id], value: { ratePlanId: c.ratePlanId, date: c.date, closed: true } });
  }
  await flushLane('rate', resolvedRates, deps, report);

  return report;
}
