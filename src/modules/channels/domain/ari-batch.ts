import { percentOf } from '../../../core/money.ts';
import type { AvailabilityChange, RateChange, Unmapped } from '../port';

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
  /**
   * Остання ніч діапазону, включно (Ц15). Порожньо — одна ніч.
   *
   * Черга кладе запис матриці без дат одним рядком, а не тисячею; батчер
   * розкладає його по датах сам, бо значення читається на КОЖНУ ніч —
   * черга тримає координату, не число. Стиснення в тілі повідомлення збере
   * однакові назад.
   */
  dateTo?: string;
  /**
   * Скільки разів вона вже НЕ поїхала. Дефолт — нуль.
   *
   * Лічильник веде черга при звільненні; домен його лише читає, щоб знати,
   * котра невдача остання дозволена (`maxAttempts`), і сказати про це вголос.
   */
  attempts?: number;
}

/**
 * Скільки разів координаті дозволено не поїхати, перш ніж вона перестане
 * захоплюватись і стане «потребує уваги».
 *
 * Одне число на домен і на чергу: шов передає його обом. Розійдуться — і
 * домен доповідатиме про застрягле, яке черга ще роздає, або навпаки.
 *
 * Чому саме десять, а не три і не сто. Ліміт вендора — 10 викликів на
 * хвилину на обʼєкт, і пауза після помилки — хвилина; кілька проходів
 * поспіль можуть чесно впертись у `429` на одному й тому самому рядку, і
 * три спроби оголошували б «увагу» там, де просто був жвавий вечір. Сто —
 * це вже тиждень щохвилинних падінь, тобто та сама тиша, від якої межа
 * існує. Десять проходів — достатньо, щоб пережити тротлінг, і замало, щоб
 * пережити незмаплений тариф непоміченим.
 */
export const DEFAULT_MAX_ATTEMPTS = 10;

/**
 * Значення однієї ночі разом із рядком черги, який його породив.
 *
 * Рядок-діапазон породжує багато значень, і вони можуть розкластись на
 * кілька пачок. Доля рядка вирішується наприкінці смуги, за всіма його
 * значеннями разом: поїхав лише той, у кого поїхало все.
 */
interface Resolved<T> {
  ids: string[];
  /** Найбільший лічильник серед координат, що злились у це значення. */
  attempts: number;
  value: T;
}

/** Дата наступного дня, рядковою арифметикою — без часових поясів. */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Усі ночі координати від `from` до кінця включно. */
function nightsOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = nextDay(d)) out.push(d);
  return out;
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
  /**
   * Скільки координат впало ВОСТАННЄ з дозволених разів — і далі захоплюватись
   * не будуть, доки їх не поверне оператор.
   *
   * Окремо від `failed`, бо це різні дії для людини: `failed` — почекати
   * наступного проходу; це — піти подивитись, чому.
   */
  needsAttention: number;
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
   * Ціни по заселеностях ПАРИ тип × тариф на цю дату. `null` — ціни немає.
   *
   * Тип номера тут не для зручності: ціна ночі належить типу, тариф її лише
   * зсуває, а на тому боці наш тариф заведений на кожен тип окремо (Ц10).
   * Той самий тариф на двох типах — дві різні ціни й два різні адресати.
   *
   * `null` це НЕ нуль і не порожній масив: ніч, яку не покриває жодне
   * джерело, закривається (інваріант 17). Порожній масив прочитався б як
   * «цін не міняли», і ніч поїхала б зі старою ціною.
   */
  pricesAt(unitTypeId: string, ratePlanId: string, date: string): Promise<{ occupancy: number; priceMinor: number }[] | null>;
  /**
   * Відправити одне повідомлення. Кидає на помилці; `warnings` — теж помилка.
   *
   * `unmapped` — наші координати, яких немає в дзеркалі. Адаптер їх уже
   * рахує; домен мусить їх ПРОЧИТАТИ, інакше такі координати позначаться
   * відправленими, хоча про них не пішло нічого. Для ціни це ПАРА тип ×
   * тариф (Ц10), не сам тариф: той самий тариф на сусідньому типі може бути
   * змаплений.
   */
  send(
    kind: 'availability' | 'rate',
    values: (AvailabilityChange | RateChange)[],
  ): Promise<{ warnings: unknown[]; unmapped?: Unmapped[] }>;
  markSent(ids: string[]): Promise<void>;
  /**
   * Повернути в чергу. `transient` — невдача ПРОХОДУ, не рядка: простій
   * вендора, 429, власна пауза обмежувача, мережа. Черга тоді не рахує
   * спроби: інакше крон раз на хвилину зʼїв би десять спроб за десять
   * хвилин звичайного простою і поставив би всю чергу в «потребує уваги» —
   * той самий шум, від якого межа спроб мала рятувати. Причина все одно
   * лягає на рядок: оператор бачить, ЧОМУ стоїть.
   */
  release(ids: string[], reason: string, transient?: boolean): Promise<void>;
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
  /**
   * Межа спроб — див. `DEFAULT_MAX_ATTEMPTS`. Те саме число, за яким черга
   * перестає роздавати рядок: домен звідси лише називає останню дозволену
   * невдачу, а зупиняє роздачу черга.
   */
  maxAttempts?: number;
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
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  // Доля кожного РЯДКА черги, не кожного значення: рядок-діапазон живе в
  // кількох пачках, і поїхав лише той, у кого поїхало все. Успіх першої
  // пачки не робить його відправленим — інакше друга половина не поїде
  // ніколи, а журнал казатиме «слали».
  const attemptsOf = new Map<string, number>();
  const delivered = new Set<string>();
  const failedFor = new Map<string, { reason: string; transient: boolean }>();
  for (const r of resolved) for (const id of r.ids) attemptsOf.set(id, Math.max(attemptsOf.get(id) ?? 0, r.attempts));

  // Невдача рядка перекриває невдачу проходу: якщо одна пачка рядка впала
  // на мережі, а інша відхилена вендором, рахується відхилення.
  const fail = (items: Resolved<T>[], reason: string, transient = false): void => {
    for (const r of items) for (const id of r.ids) {
      const prior = failedFor.get(id);
      if (prior && !prior.transient && transient) continue;
      failedFor.set(id, { reason, transient });
    }
  };

  for (const batch of intoBatches(resolved, max, sizeOf as (v: T) => number)) {
    try {
      const answer = await deps.send(kind, batch.map((r) => r.value));

      // Незмаплене — НЕ успіх. Закрити ми його теж не можемо: не знаємо, що
      // саме закривати на тому боці, а тариф там лишається живим і
      // продається далі. Тому гучна відмова, і рядок лишається в черзі — до
      // межі спроб, після якої він стає «потребує уваги».
      const unmapped = answer.unmapped ?? [];
      const orphans = unmapped.length
        ? batch.filter((r) => unmapped.some((u) => sameCoordinate(u, r.value)))
        : [];
      if (orphans.length) fail(orphans, `unmapped ${unmapped.map(describe).join(', ')}`);
      const rest = batch.filter((r) => !orphans.includes(r));
      // `200 OK` з непорожніми претензіями — це помилка, а не успіх (И4).
      // Порожній результат означає, що не застосовано НІЧОГО, тож позначити
      // рядки відправленими означало б втратити зміну, доповівши про успіх.
      if (answer.warnings && answer.warnings.length > 0) {
        fail(rest, `${answer.warnings.length} claim(s): ${JSON.stringify(answer.warnings).slice(0, 300)}`);
      } else {
        for (const r of rest) for (const id of r.ids) delivered.add(id);
      }
    } catch (e: any) {
      // Найважливіший рядок у всьому файлі — див. правило 1 у шапці.
      // `transient` ставить адаптер: він один знає, що 429 і пауза — про
      // прохід, а 422 — про значення.
      fail(batch, String(e?.message ?? e), e?.transient === true);
    }
    report.calls++;
  }

  const sentIds = [...delivered].filter((id) => !failedFor.has(id));
  if (sentIds.length) {
    await deps.markSent(sentIds);
    report.sent += sentIds.length;
  }

  // Звільнення — один раз на рядок, по одній причині на групу. Стається
  // ЗАВЖДИ, навіть для вичерпаних: саме воно робить рядок видимим як
  // застряглий (черга перестає роздавати за лічильником, не за захопленням).
  const byReason = new Map<string, { reason: string; transient: boolean; ids: string[] }>();
  for (const [id, f] of failedFor) {
    const key = `${f.transient ? 't' : 'r'}|${f.reason}`;
    const group = byReason.get(key) ?? { reason: f.reason, transient: f.transient, ids: [] };
    group.ids.push(id);
    byReason.set(key, group);
  }
  for (const { reason, transient, ids } of byReason.values()) {
    await deps.release(ids, reason, transient);
    report.failed += ids.length;
    report.errors.push(`${kind}: ${reason}`);
  }
  // «Потребує уваги» — лише за невдачі САМОГО рядка: транспортна не рахує спроб.
  const exhausted = [...failedFor]
    .filter(([id, f]) => !f.transient && (attemptsOf.get(id) ?? 0) + 1 >= maxAttempts)
    .map(([id]) => id);
  if (exhausted.length) {
    report.needsAttention += exhausted.length;
    report.errors.push(
      `${kind}: ${exhausted.length} coordinate(s) reached the attempt limit (${maxAttempts}) — needs attention`,
    );
  }
}

/** Та сама координата: збігаються обидва наші ідентифікатори, включно з порожнім. */
function sameCoordinate(u: Unmapped, v: AvailabilityChange | RateChange): boolean {
  return (u.unitTypeId ?? null) === ((v as RateChange).unitTypeId ?? null)
    && (u.ratePlanId ?? null) === ((v as RateChange).ratePlanId ?? null);
}

function describe(u: Unmapped): string {
  return u.ratePlanId ? `${u.ratePlanId}@${u.unitTypeId ?? '?'}` : String(u.unitTypeId);
}

/**
 * Взяти з черги все, що чекає, і відправити.
 *
 * Викликається ВСЕРЕДИНІ контексту орендаря: черга, джерела значень і
 * дзеркало читаються в його межах.
 */
export async function flushOutbox(deps: FlushDeps): Promise<FlushReport> {
  const report: FlushReport = { sent: 0, failed: 0, retired: 0, needsAttention: 0, calls: 0, errors: [] };

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
    const endOf = (c: ClaimedCoordinate) => c.dateTo ?? c.date;
    const past = claimed.filter((c) => endOf(c) < today);
    if (past.length) {
      await deps.retire(past.map((c) => c.id), `date in the past (today ${today})`);
      report.retired += past.length;
    }
    // Діапазон, що почався вчора, не знімається — його майбутні ночі
    // справжні; обрізається лише початок.
    return claimed
      .filter((c) => endOf(c) >= today)
      .map((c) => (c.date < today ? { ...c, date: today } : c));
  };

  /**
   * Координата, якій бракує половини адреси, не поїде НІКОЛИ: наявність без
   * типу нема на що покласти, ціну без типу або тарифу — нема чим ні
   * цінувати, ні адресувати (пара, Ц10). Черга таких не приймає; якщо рядок
   * усе ж є, він знімається з названою причиною й рахується — «не слати»
   * серед відповідей не існує.
   */
  const addressed = async (claimed: ClaimedCoordinate[], what: string): Promise<ClaimedCoordinate[]> => {
    const half = claimed.filter((c) => !c.unitTypeId || (c.kind === 'rate' && !c.ratePlanId));
    if (half.length) {
      await deps.retire(half.map((c) => c.id), `${what} coordinate without unit type or rate plan — cannot be addressed`);
      report.retired += half.length;
    }
    return claimed.filter((c) => !half.includes(c));
  };

  // ── Наявність ────────────────────────────────────────────────────────
  const availability = await addressed(await alive(await deps.claim('availability')), 'availability');
  const resolvedAvailability: Resolved<AvailabilityChange>[] = [];
  for (const c of availability) {
    if (!c.unitTypeId) continue;
    for (const date of nightsOf(c.date, c.dateTo ?? c.date)) {
      const free = await deps.availabilityAt(c.unitTypeId, date);
      resolvedAvailability.push({
        ids: [c.id],
        attempts: c.attempts ?? 0,
        value: { unitTypeId: c.unitTypeId, date, free: free ?? 0 },
      });
    }
  }
  await flushLane('availability', resolvedAvailability, deps, report);

  // ── Ціни й обмеження ─────────────────────────────────────────────────
  const rates = await addressed(await alive(await deps.claim('rate')), 'rate');
  const resolvedRates: Resolved<RateChange>[] = [];
  for (const c of rates) {
    if (!c.unitTypeId || !c.ratePlanId) continue;
    for (const date of nightsOf(c.date, c.dateTo ?? c.date)) {
      const base = await deps.pricesAt(c.unitTypeId, c.ratePlanId, date);
      const prices = shift(base, deps.priceModifierPercent ?? 0);
      // Правило 2 з шапки, і воно тут ціле в двох рядках: або ціни та явне
      // відкриття, або закриття. Третього — «не слати» — немає.
      const at = { ratePlanId: c.ratePlanId, unitTypeId: c.unitTypeId, date };
      resolvedRates.push(prices && prices.length
        ? { ids: [c.id], attempts: c.attempts ?? 0, value: { ...at, prices, closed: false } }
        : { ids: [c.id], attempts: c.attempts ?? 0, value: { ...at, closed: true } });
    }
  }
  await flushLane('rate', resolvedRates, deps, report);

  return report;
}
