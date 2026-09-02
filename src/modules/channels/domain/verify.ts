/**
 * Звірка П6: чи справді те, що ми відправили, лежить у календарі каналу.
 *
 *   node src/modules/channels/domain/verify.check.ts
 *
 * Менеджер каналів приймає ціну як ЗАДАЧУ: `200` з розпискою означає «взяв»,
 * не «застосував», а ендпоінта стану задачі в нього немає. Тож єдиний спосіб
 * дізнатись, що ціна доїхала, — прочитати календар назад і порівняти з тим,
 * що ми мали на увазі. Це і є звірка: очікуване з наших джерел (ті самі
 * `priceNights()` і `availabilityByDay()`, що годують батчер) проти
 * прочитаного з того боку.
 *
 * ── Що тут є, а чого немає ──────────────────────────────────────────────
 *
 * Є порівняння і рішення «що повертати в чергу». Немає жодного чужого імені:
 * ніч з того боку приходить уже доменними словами (`closed`, `free`,
 * `rateMinor`), а хто і як її прочитав — справа адаптера (И1, И13).
 *
 * ── Три відповіді, не дві ────────────────────────────────────────────────
 *
 *   збігається   — усе, що ми казали, там і лежить;
 *   розходиться  — той бік каже інше число: координата ПОВЕРТАЄТЬСЯ в чергу
 *                  з названою причиною, і наступний прохід шле поточне
 *                  значення знову;
 *   не звірено   — той бік не віддав поля або самої ночі: це не розбіжність
 *                  (переслати нема чого) і не збіг (нічого не доведено).
 *                  Показується окремо, бо мовчання гейта — не доведеність.
 *
 * Змішати друге з третім означало б або вічне коло (ніч, якої вендор не
 * повертає, переслалась би щозвірки), або тиху діру (поле, якого вендор не
 * повертає, рахувалось би збігом).
 */

export type VerifiedField = 'free' | 'rate' | 'closed' | 'minStay' | 'maxStay' | 'noArrival' | 'noDeparture';

/** Що ми мали на увазі для однієї ночі — те саме, що поїхало в канал. */
export interface ExpectedNight {
  kind: 'availability' | 'rate';
  unitTypeId: string;
  /** Для ціни — тариф пари; для наявності порожньо. */
  ratePlanId?: string;
  /** Для ціни — заселеність опції (И13); для наявності порожньо. */
  occupancy?: number;
  date: string;
  /** Наявність: скільки вільно. */
  free?: number;
  /** Ціна цієї заселеності в мінорних одиницях; `null` — ціни немає (ніч закрита). */
  rateMinor?: number | null;
  closed?: boolean;
  minStay?: number;
  maxStay?: number;
  noArrival?: boolean;
  noDeparture?: boolean;
}

/**
 * Ніч, як її віддав той бік, — доменними словами.
 *
 * `undefined` — поля у відповіді немає; `null` для ціни — «ціни немає».
 * Різниця значуща: перше — «не звірено», друге — число, з яким порівнюємо.
 */
export interface RemoteNight {
  free?: number;
  rateMinor?: number | null;
  closed?: boolean;
  minStay?: number;
  maxStay?: number;
  noArrival?: boolean;
  noDeparture?: boolean;
}

export interface Mismatch {
  kind: 'availability' | 'rate';
  unitTypeId: string;
  ratePlanId?: string;
  occupancy?: number;
  date: string;
  /** `night` — тієї ночі у відповіді немає взагалі. */
  field: VerifiedField | 'night';
  ours: string;
  theirs: string;
}

/** Поле, якого той бік не віддав, — не звірено, і це названо. */
export interface Unverified {
  field: VerifiedField | 'night';
  count: number;
}

export interface VerifyReport {
  /** Скільки полів порівняно (кожна ніч — кілька полів). */
  checked: number;
  matched: number;
  /** Той бік каже інше — координата повертається в чергу. */
  mismatches: Mismatch[];
  /** Той бік не віддав — переслати нема чого, доведеності теж немає. */
  unverified: Unverified[];
}

/**
 * Підсумок звірки одного зʼєднання — те, що бачить оператор і живий прохід.
 *
 * `fresh` — відправлення, молодші за вікно застосування: вендор кладе задачі
 * асинхронно, і читати їх назад за секунду означало б повернути в чергу те,
 * що ще не встигло лягти. `beyond` — ночі поза горизонтом звірки: календар
 * читається одним запитом, і пів року на кожен клік — не той запит.
 */
export interface SendsVerification extends VerifyReport {
  /** Скільки відправлень узято до звірки. */
  sends: number;
  /** Скільки ще застосовуються — не звірялись. */
  fresh: number;
  /** Скільки ночей лишилось поза горизонтом. */
  beyond: number;
  /** Скільки координат повернуто в чергу. */
  requeued: number;
  /** Вікно, яке читалось у вендора; `null` — не було чого читати. */
  window: { from: string; to: string } | null;
}

/** Координата, яку треба повернути в чергу, з причиною для рядка. */
export interface RequeueCoordinate {
  kind: 'availability' | 'rate';
  unitTypeId: string;
  ratePlanId?: string;
  date: string;
  reason: string;
}

const show = (v: unknown): string => (v === undefined ? '—' : v === null ? 'немає' : String(v));

/**
 * Порівняти очікуване з прочитаним. `remote` віддає ніч того боку або `null`,
 * якщо її там немає.
 *
 * Порівнюються лише поля, які МИ називали: ніч без обмежень у нас не
 * стверджує нічого про обмеження там. Ціна порівнюється копійка в копійку —
 * це вже цілі мінорні одиниці з обох боків.
 */
export function verifyNights(
  expected: ExpectedNight[],
  remote: (night: ExpectedNight) => RemoteNight | null,
): VerifyReport {
  const report: VerifyReport = { checked: 0, matched: 0, mismatches: [], unverified: [] };
  const unverified = new Map<VerifiedField | 'night', number>();
  const miss = (e: ExpectedNight, field: VerifiedField | 'night', ours: unknown, theirs: unknown) => {
    report.mismatches.push({
      kind: e.kind, unitTypeId: e.unitTypeId, ratePlanId: e.ratePlanId, occupancy: e.occupancy, date: e.date,
      field, ours: show(ours), theirs: show(theirs),
    });
  };
  const compare = (e: ExpectedNight, r: RemoteNight, field: VerifiedField, ours: unknown, theirs: unknown) => {
    if (ours === undefined) return;
    if (theirs === undefined) { unverified.set(field, (unverified.get(field) ?? 0) + 1); return; }
    report.checked++;
    if (ours === theirs) report.matched++;
    else miss(e, field, ours, theirs);
  };

  for (const e of expected) {
    const r = remote(e);
    if (!r) { unverified.set('night', (unverified.get('night') ?? 0) + 1); miss(e, 'night', 'є', 'немає'); continue; }
    if (e.kind === 'availability') {
      compare(e, r, 'free', e.free, r.free);
      continue;
    }
    // Ціна порівнюється лише там, де ми її називали: закрита ніч без ціни
    // нічого про число не стверджує, а «закрито» стверджує завжди.
    if (e.rateMinor != null) compare(e, r, 'rate', e.rateMinor, r.rateMinor);
    compare(e, r, 'closed', e.closed ?? false, r.closed);
    compare(e, r, 'minStay', e.minStay, r.minStay);
    compare(e, r, 'maxStay', e.maxStay, r.maxStay);
    compare(e, r, 'noArrival', e.noArrival, r.noArrival);
    compare(e, r, 'noDeparture', e.noDeparture, r.noDeparture);
  }

  report.unverified = [...unverified].map(([field, count]) => ({ field, count }));
  return report;
}

/**
 * Що повертати в чергу: одна координата на пару × дату (Ц10), хоч би скільки
 * заселеностей чи полів розійшлось, — черга тримає координати, не значення.
 * Ніч, якої той бік не має взагалі, НЕ повертається: пересилання її не
 * створить, а вічне коло — створить.
 */
export function coordinatesToRequeue(mismatches: Mismatch[]): RequeueCoordinate[] {
  const out = new Map<string, RequeueCoordinate>();
  for (const m of mismatches) {
    if (m.field === 'night') continue;
    const key = `${m.kind}|${m.unitTypeId}|${m.ratePlanId ?? ''}|${m.date}`;
    const found = out.get(key);
    const detail = `${m.field}${m.occupancy != null ? `@${m.occupancy}` : ''} ${m.ours} ≠ ${m.theirs}`;
    if (found) found.reason = `${found.reason}; ${detail}`;
    else out.set(key, { kind: m.kind, unitTypeId: m.unitTypeId, ratePlanId: m.ratePlanId, date: m.date, reason: `verify: ${detail}` });
  }
  return [...out.values()];
}
