/**
 * Каталог у менеджері каналів: що там мусить існувати і під якими там id.
 *
 *   node src/modules/channels/domain/catalog.check.ts
 *
 * ── Що це і чого тут немає ──────────────────────────────────────────────
 *
 * Це ПОРЯДОК ДІЙ, а не розмова з вендором. Імені вендора тут немає й бути не
 * може (інваріант И1): «завести обʼєкт, потім типи номерів, потім тарифи, і
 * запамʼятати чужі ідентифікатори» — однаково в будь-якого менеджера каналів.
 * Як саме це надіслати, знає адаптер.
 *
 * ── Наша пара «тип × тариф» — це ОДИН їхній тариф ───────────────────────
 *
 * У нас тариф належить обʼєкту, а вісь заселеності — типу номера
 * (інваріант 15). У менеджера каналів тариф належить ТИПУ НОМЕРА й носить
 * заселеності в собі. Тому наш тариф, який має ціни на трьох типах, стає
 * ТРЬОМА тарифами на тому боці (рішення Ц6).
 *
 * Звідси єдина нетривіальна річ у цьому файлі: ключ дзеркала — пара, а не
 * тариф. Дзеркало, ключоване самим лише тарифом, затирало б попередній рядок
 * на кожному наступному типі номера — і залишало б рівно один із трьох,
 * мовчки. Наявність і ціни поїхали б у той один, а два інші типи назавжди
 * лишились би без обміну; жодної помилки при цьому не сталося б.
 *
 * ── Ціни цей прохід НЕ везе ─────────────────────────────────────────────
 *
 * Створення каталогу і публікація ARI — різні фази й різні ліміти. Понад те,
 * у Channex ціна, задана при створенні тарифу, засіває КАЛЕНДАР на всі
 * майбутні дати (INVENTORY §3.1) — тобто «просто заповнити поле» означає
 * опублікувати ціну, якої ніхто не називав (інваріант 17).
 *
 * Тому цей прохід не читає цінових таблиць взагалі: він питає лише, ЧИ Є
 * ціна (`sellable`), а не яка вона. Це твердження не залежить від розвилки
 * Ц7 і не переїде разом із `pricing_modifier_percent`: скільки коштує ніч і
 * що зсуває точка збуту — питання фази 4, а не каталогу.
 *
 * ── Тариф без жодної ціни не їде ────────────────────────────────────────
 *
 * Інваріант 17. Він НАЗИВАЄТЬСЯ у звіті (`skipped`), а не зникає мовчки:
 * оператор, який завів тариф і не поставив цін, має побачити причину, а не
 * гадати, чому канал його не бачить.
 */

/** Обʼєкт, як його треба завести на тому боці. */
export interface CatalogProperty {
  /** НАШ id. */
  id: string;
  title: string;
  /** ISO 4217. */
  currency: string;
  country?: string | null;
  city?: string | null;
  address?: string | null;
  zipCode?: string | null;
  email?: string | null;
  phone?: string | null;
  timezone?: string | null;
}

/** Тип номера, як його треба завести на тому боці. */
export interface CatalogUnitType {
  id: string;
  code: string;
  title: string;
  /** Скільки фізичних номерів цього типу. Нуль означає «немає що продавати». */
  roomCount: number;
  maxAdults: number;
  maxChildren: number;
  /**
   * Скільки осіб селиться за замовчуванням.
   *
   * Не більше за `maxAdults` — менеджер каналів відхиляє більше, і одна така
   * помилка валить синхронізацію всього каталогу.
   */
  defaultOccupancy: number;
}

/** Тариф на КОНКРЕТНОМУ типі номера — тобто вже пара (Ц6). */
export interface CatalogRatePlanOnUnitType {
  unitTypeId: string;
  /** Заселеності, які тариф продає на цьому типі, — за режимом, не вище місткості. */
  occupancies: number[];
}

/** Тариф, як його бачить домен. */
export interface CatalogRatePlan {
  id: string;
  code: string;
  title: string;
  currency: string;
  mealPlan: string | null;
  /**
   * Як рахує гостей (Ц26): `per_room` — одна ціна на номер і одна опція на
   * максимальну місткість; `per_person` — своя ціна на кожну кількість
   * дорослих, опція на кожну. Їде у вендора явно: без поля той ставить
   * `per_room`, і тариф з опцією на кожну заселеність суперечить сам собі.
   */
  sellMode: 'per_room' | 'per_person';
  /** Типи номерів, на яких цей тариф має ціни. Порожньо — його не продати. */
  on: CatalogRatePlanOnUnitType[];
  /** Чи є що продавати. `false` — тариф називається у звіті й не їде. */
  sellable: boolean;
}

/** Опція заселеності, як її повернув той бік. */
export interface RemoteOption {
  occupancy: number;
  /** Чужий id опції. В основної збігається з id самого тарифу. */
  id: string;
}

/**
 * Той бік — рівно те, що від нього треба, і нічого більше.
 *
 * Кожен метод СТВОРЮЄ і повертає чужий id. Нічого не оновлює: каталог, який
 * уже є, цей прохід не чіпає (див. `syncCatalog`).
 */
export interface CatalogTarget {
  createProperty(property: CatalogProperty): Promise<string>;
  createUnitType(remotePropertyId: string, unitType: CatalogUnitType): Promise<string>;
  /**
   * Тариф на одному типі номера.
   *
   * `occupancies` їдуть опціями. Ціни серед аргументів немає навмисно — див.
   * шапку файла.
   */
  createRatePlan(
    remotePropertyId: string,
    remoteUnitTypeId: string,
    plan: CatalogRatePlan,
    occupancies: number[],
  ): Promise<{ id: string; options: RemoteOption[] }>;
}

/** Дзеркало: наше ↔ їхнє. Пара «тип × тариф» ключується обома. */
export interface CatalogMirror {
  /** Чужий id, якщо ця сутність уже заведена. */
  remoteIdOf(
    entityType: 'property' | 'unit_type' | 'rate_plan' | 'rate_plan_option',
    localId: string,
    unitTypeId?: string,
    occupancy?: number,
  ): Promise<string | null>;
  put(row: {
    entityType: 'property' | 'unit_type' | 'rate_plan' | 'rate_plan_option';
    localId: string;
    /** Другий бік пари. Порожньо для обʼєкта й типу номера. */
    unitTypeId?: string;
    occupancy?: number;
    remoteId: string;
  }): Promise<void>;
}

export interface CatalogDeps {
  property: CatalogProperty;
  unitTypes: CatalogUnitType[];
  ratePlans: CatalogRatePlan[];
  target: CatalogTarget;
  mirror: CatalogMirror;
}

/** Чому одна сутність не поїхала. */
export interface CatalogSkip {
  what: 'unit_type' | 'rate_plan';
  localId: string;
  reason: 'no_price' | 'no_rooms' | 'unit_type_not_mapped';
}

export interface CatalogReport {
  /** Чужий id обʼєкта — той, яким далі адресується все інше. */
  remotePropertyId: string;
  /** Скільки СТВОРЕНО цього разу. Другий прохід дає нулі. */
  created: { unitTypes: number; ratePlans: number; options: number };
  /** Скільки вже було і не чіпалося. */
  existing: { unitTypes: number; ratePlans: number };
  skipped: CatalogSkip[];
}

/**
 * Завести каталог і повернути звіт.
 *
 * ── Створює лише те, чого немає ─────────────────────────────────────────
 *
 * Не «створити або оновити». Оновлення тут коштувало б дорожче, ніж здається:
 * повторне надсилання тарифу з полем ціни перезаписало б засів календаря на
 * тому боці (INVENTORY §3.1), тобто прохід, який мав лише перейменувати
 * тариф, мовчки змінив би ціни на всі майбутні дати. Тому те, що вже
 * заведене, лишається як є, а зміни назв і полів — окрема робота з окремим
 * рішенням.
 *
 * ── Тип номера без жодного номера не їде ────────────────────────────────
 *
 * `count_of_rooms > 0` — вимога того боку. Тип, під яким немає жодної
 * кімнати, це заготовка оператора, а не товар.
 */
export async function syncCatalog(deps: CatalogDeps): Promise<CatalogReport> {
  const { property, unitTypes, ratePlans, target, mirror } = deps;

  const report: CatalogReport = {
    remotePropertyId: '',
    created: { unitTypes: 0, ratePlans: 0, options: 0 },
    existing: { unitTypes: 0, ratePlans: 0 },
    skipped: [],
  };

  // ── Обʼєкт ───────────────────────────────────────────────────────────
  let remotePropertyId = await mirror.remoteIdOf('property', property.id);
  if (!remotePropertyId) {
    remotePropertyId = await target.createProperty(property);
    await mirror.put({ entityType: 'property', localId: property.id, remoteId: remotePropertyId });
  }
  report.remotePropertyId = remotePropertyId;

  // ── Типи номерів ─────────────────────────────────────────────────────
  const remoteUnitTypes = new Map<string, string>();
  for (const unitType of unitTypes) {
    const known = await mirror.remoteIdOf('unit_type', unitType.id);
    if (known) {
      remoteUnitTypes.set(unitType.id, known);
      report.existing.unitTypes++;
      continue;
    }
    if (unitType.roomCount <= 0) {
      report.skipped.push({ what: 'unit_type', localId: unitType.id, reason: 'no_rooms' });
      continue;
    }
    const remoteId = await target.createUnitType(remotePropertyId, unitType);
    await mirror.put({ entityType: 'unit_type', localId: unitType.id, remoteId });
    remoteUnitTypes.set(unitType.id, remoteId);
    report.created.unitTypes++;
  }

  // ── Тарифи: по одному на КОЖНУ пару «тип × тариф» ────────────────────
  for (const plan of ratePlans) {
    if (!plan.sellable || plan.on.length === 0) {
      report.skipped.push({ what: 'rate_plan', localId: plan.id, reason: 'no_price' });
      continue;
    }

    for (const on of plan.on) {
      const remoteUnitTypeId = remoteUnitTypes.get(on.unitTypeId);
      if (!remoteUnitTypeId) {
        // Тип пропущено вище (немає номерів) — тариф на ньому нікуди подіти.
        // Це не помилка проходу: решта пар цього ж тарифу їде як їхала.
        report.skipped.push({
          what: 'rate_plan', localId: plan.id, reason: 'unit_type_not_mapped',
        });
        continue;
      }

      const known = await mirror.remoteIdOf('rate_plan', plan.id, on.unitTypeId);
      if (known) {
        report.existing.ratePlans++;
        continue;
      }

      const made = await target.createRatePlan(
        remotePropertyId, remoteUnitTypeId, plan, on.occupancies,
      );
      await mirror.put({
        entityType: 'rate_plan', localId: plan.id, unitTypeId: on.unitTypeId, remoteId: made.id,
      });
      report.created.ratePlans++;

      // Опції заселеності. Без цих рядків власні ціни неможливо прочитати
      // назад: живий календар індексований опцією, а не тарифом
      // (INVENTORY §4.5), і id неосновних опцій не повертаються більше ніде.
      for (const option of made.options) {
        await mirror.put({
          entityType: 'rate_plan_option',
          localId: plan.id,
          unitTypeId: on.unitTypeId,
          occupancy: option.occupancy,
          remoteId: option.id,
        });
        report.created.options++;
      }
    }
  }

  return report;
}
