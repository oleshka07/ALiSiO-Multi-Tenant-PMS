import { percentOf } from '../../../core/money.ts';
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
  /**
   * Скільки знято з черги без відправлення — координати, які не поїдуть
   * НІКОЛИ (минула дата). Рахуються окремо: це не успіх і не провал, і
   * мовчазне зникнення тут було б гіршим за обидва.
   */
  retired: number;
  /** Скільки викликів зроблено — те, що витрачає квоту обʼєкта. */
  calls: number;
  /** Причини повернення, по одній на смугу. */
  errors: string[];
}

export interface FlushDeps {
  /**
   * Чи ввімкнене зʼєднання. Дефолт — так.
   *
   * Готель, який вимкнув канал, перестав там продавати; штовхати в нього
   * ціни означає продавати за нього. Але й черги не чіпаємо: вимкнення
   * буває тимчасовим, і після вмикання канал має отримати ПОТОЧНИЙ стан, а
   * не порожнечу. Друга варта поверх фільтра в крона — ціна помилки тут
   * вища за ціну зайвої перевірки.
   */
  isEnabled?(): Promise<boolean>;
  /**
   * Сьогоднішня дата, `YYYY-MM-DD`. Дефолт — системна.
   *
   * Потрібна не для зручності: минулі дати вендор не приймає взагалі, тож
   * координата в минулому не поїде НІКОЛИ. Повертати її в чергу — вічне
   * коло, яке щопроходу рахує спробу й забиває смугу собі подібними.
   */
  today?: string;
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
  /**
   * Відправити одне повідомлення. Кидає на помилці; `warnings` — теж помилка.
   *
   * `unmapped` — наші ідентифікатори, яких немає в дзеркалі. Адаптер їх уже
   * рахує; домен мусить їх ПРОЧИТАТИ, інакше такі координати позначаться
   * відправленими, хоча про них не пішло нічого.
   */
  send(
    kind: 'availability' | 'rate',
    values: (AvailabilityChange | RateChange)[],
  ): Promise<{ warnings: unknown[]; unmapped?: string[] }>;
  markSent(ids: string[]): Promise<void>;
  release(ids: string[], reason: string): Promise<void>;
  /**
   * Зняти координату з черги без відправлення.
   *
   * Не `markSent`: нічого не відправлено, і брехати про це нікому не можна.
   * Не `release`: рядок не поїде ніколи, і повернення означало б вічне коло.
   * Третій стан тут — єдина чесна відповідь; дані можуть записати його як
   * `sent_at` разом із причиною в `last_error`.
   */
  retire(ids: string[], reason: string): Promise<void>;
  /**
   * Зсув ЦІЄЇ точки збуту, у відсотках. Дефолт — нуль.
   *
   * Рішення Ц7: ціна одна — база з `price_calendar × rate_plans`, названа
   * `priceNights()`. Точка збуту її ЗСУВАЄ і нічого не називає. Число тут
   * ЗНАКОВЕ: `-10` це «дешевше на 10%», `+10` — «дорожче». Пари «відсоток +
   * напрямок» тут немає навмисно — два поля можуть суперечити одне одному
   * (відʼємне число з напрямком «дешевше» — подвійне заперечення), і
   * перенесення колонки саме на цьому й ловилось.
   *
   * ── Модифікатор однієї точки збуту НІКОЛИ не потрапляє в іншу ─────────
   *
   * Це і є визначення «прямо дешевше». Сюди приходить зсув ЗʼЄДНАННЯ; зсув
   * сайту живе в сайтовому дереві й до каналу не має стосунку. Якби він
   * доїхав, знижка прямого каналу опинилась би на OTA — рівно навпаки до
   * того, заради чого Ц7 ухвалювалось.
   *
   * Перевірка на це стоїть на НЕНУЛЬОВОМУ числі навмисно: при нулі
   * застосований зсув і забутий зсув дають однакову відповідь, і гейт був
   * би зеленим в обох світах.
   */
  priceModifierPercent?: number;
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

/**
 * Зсунути базу модифікатором точки збуту (Ц7).
 *
 * Округлення до ЦІЛОЇ мінорної одиниці одразу: дробова копійка по дорозі
 * через JSON — це те, як ціна стає 24.999999, а канал показує гостю число,
 * якого готель не називав.
 *
 * Рахує `percentOf(x, pct, 0)` з `@core/money`, а не `Math.round` — інваріант
 * 9, і не з формальності: власне множення пішло б через `x * 100`, а
 * `1.005 * 100` це 100.49999999999999, тобто округлення ВНИЗ там, де людина
 * чекає вгору. `money()` зсуває через рядок і саме тому не має цієї діри.
 * Нуль знаків — бо тут уже мінорні одиниці: ціла копійка і є мінімальна.
 *
 * Нуль означає «не зсувати», і саме тому він тут дефолт: точка збуту, яка
 * нічого не сказала, нічого й не міняє.
 */
function shift(
  prices: { occupancy: number; priceMinor: number }[] | null,
  percent: number,
): { occupancy: number; priceMinor: number }[] | null {
  if (!prices || !percent) return prices;
  return prices.map((p) => ({
    occupancy: p.occupancy,
    priceMinor: p.priceMinor + percentOf(p.priceMinor, percent, 0),
  }));
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

      // Незмаплене — НЕ успіх. Закрити ми його теж не можемо: не знаємо, що
      // саме закривати на тому боці, а тариф там лишається живим і
      // продається далі. Тому гучна відмова, і рядок лишається в черзі.
      const orphanIds = (answer.unmapped ?? []).length
        ? batch.filter((r) => (answer.unmapped ?? []).some((local) =>
            local === (r.value as RateChange).ratePlanId
            || local === (r.value as AvailabilityChange).unitTypeId)).flatMap((r) => r.ids)
        : [];
      if (orphanIds.length) {
        await deps.release(orphanIds, `unmapped: ${(answer.unmapped ?? []).join(', ')}`);
        report.failed += orphanIds.length;
        report.errors.push(`${kind}: unmapped ${(answer.unmapped ?? []).join(', ')}`);
      }
      const deliveredIds = ids.filter((id) => !orphanIds.includes(id));
      // `200 OK` з непорожніми претензіями — це помилка, а не успіх (И4).
      // Порожній результат означає, що не застосовано НІЧОГО, тож позначити
      // рядки відправленими означало б втратити зміну, доповівши про успіх.
      if (answer.warnings && answer.warnings.length > 0) {
        await deps.release(deliveredIds, `warnings: ${JSON.stringify(answer.warnings).slice(0, 300)}`);
        report.failed += deliveredIds.length;
        report.errors.push(`${kind}: ${answer.warnings.length} claim(s)`);
      } else if (deliveredIds.length) {
        await deps.markSent(deliveredIds);
        report.sent += deliveredIds.length;
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
  const report: FlushReport = { sent: 0, failed: 0, retired: 0, calls: 0, errors: [] };

  // Вимкнене зʼєднання не шле нічого — і черги не втрачає. Це не провал,
  // тож ні `failed`, ні алерту з нього бути не має.
  if (deps.isEnabled && !(await deps.isEnabled())) return report;

  const today = deps.today ?? new Date().toISOString().slice(0, 10);

  /**
   * Відсіяти те, що не поїде ніколи, і зняти з черги.
   *
   * Робиться ДО читання джерел: питати ціну на позавчора — марна робота, а
   * на тисячі застарілих рядків ще й помітна.
   */
  const alive = async (claimed: ClaimedCoordinate[]): Promise<ClaimedCoordinate[]> => {
    const past = claimed.filter((c) => c.date < today);
    if (past.length) {
      await deps.retire(past.map((c) => c.id), `date in the past (today ${today})`);
      report.retired += past.length;
    }
    return claimed.filter((c) => c.date >= today);
  };

  // ── Наявність ────────────────────────────────────────────────────────
  const availability = await alive(await deps.claim('availability'));
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
  const rates = await alive(await deps.claim('rate'));
  const resolvedRates: Resolved<RateChange>[] = [];
  for (const c of rates) {
    if (!c.ratePlanId) continue;
    const base = await deps.pricesAt(c.ratePlanId, c.date);
    const prices = shift(base, deps.priceModifierPercent ?? 0);
    // Правило 2 з шапки, і воно тут ціле в двох рядках: або ціни та явне
    // відкриття, або закриття. Третього — «не слати» — немає.
    resolvedRates.push(prices && prices.length
      ? { ids: [c.id], value: { ratePlanId: c.ratePlanId, date: c.date, prices, closed: false } }
      : { ids: [c.id], value: { ratePlanId: c.ratePlanId, date: c.date, closed: true } });
  }
  await flushLane('rate', resolvedRates, deps, report);

  return report;
}
