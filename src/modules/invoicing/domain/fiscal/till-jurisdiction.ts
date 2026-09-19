/**
 * Which fiscal module a till's country requires — one place, not two ifs.
 *
 * ── Чому це реєстр, а не гілка в писачі ─────────────────────────────────
 *
 * Поки країна була одна, `if (country === 'DE')` у `folio-payments.repo.ts`
 * читався нормально. Друга країна перетворює це на питання, яке ставиться
 * при КОЖНІЙ новій юрисдикції й на яке легко забути відповісти: «а чи
 * потрібен цій касі модуль». Реєстр робить забування видимим — країни, якої
 * тут немає, каса не питає ні про що, і це написано одним рядком, а не
 * відсутністю рядка.
 *
 * ── Чому це НЕ порушення інваріанта 22 ──────────────────────────────────
 *
 * Інваріант забороняє назву країни, її закону або її документа в імені
 * ТАБЛИЦІ, КОЛОНКИ чи значення CHECK — тобто в моделі даних ядра. Тут немає
 * ні того, ні іншого, ні третього: це мапа «код країни → ключ модуля», і
 * вона і є той шов, яким ядро віддає юрисдикцію модулю. Десь він мусить
 * бути, інакше модуль неможливо було б увімкнути.
 *
 * Чого тут НЕМАЄ і не буде: правил конкретної країни. Що друкується на
 * чеку, який рядок поза базою ПДВ, як називається документ — усе це в
 * модулі (`@fiscal-ua`, `data/fiskaly-sign-de.ts`), а тут лише «кому
 * дзвонити».
 *
 * Файл чистий і без імпортів: його читають сцени під голим node, а тип
 * ключа названо літералами, щоб не тягнути `@core/features` (він тягне базу).
 */

/** Ключ модуля, який мусить бути ввімкнений, щоб каса цієї країни працювала. */
export type TillFiscalFeature = 'fiscal_de' | 'fiscal_ua';

export interface TillFiscalRule {
  feature: TillFiscalFeature;
  /**
   * Текст відмови, коли ключа немає. Своїми словами, не словами бази
   * (інваріант 6), і різний у різних країнах — бо різний закон.
   */
  refusal: string;
}

const TILL_FISCAL: Readonly<Record<string, TillFiscalRule>> = {
  // §146a AO: PMS, яка записує готівку без TSE, і є «elektronisches
  // Aufzeichnungssystem» без сертифікованої захисної частини.
  DE: {
    feature: 'fiscal_de',
    refusal: 'Cash and card payments for a German property are still recorded in the old till system — the fiscal module (TSE) is not enabled yet',
  },
  // Готівка й термінал на рецепції в Україні проходять через програмний
  // реєстратор розрахункових операцій. PMS, яка приймає їх без нього, — це
  // незареєстрована каса, тобто та сама вада, що в DE, лише інший закон.
  UA: {
    feature: 'fiscal_ua',
    refusal: 'Cash and card payments for a Ukrainian property need the fiscal module (ПРРО) — until it is enabled this PMS must not act as an unregistered till',
  },
};

/**
 * Правило для країни обʼєкта, або `null` — країна модуля не вимагає.
 *
 * Вісь — країна ОБʼЄКТА. Не мова оператора (німець на зміні в Києві не
 * робить касу німецькою) і не валюта рахунку (готель у Львові, що рахує в
 * євро, лишається українською касою).
 */
export function tillFiscalRule(country: unknown): TillFiscalRule | null {
  const code = String(country || '').toUpperCase();
  return TILL_FISCAL[code] ?? null;
}

/** Країни, які СЬОГОДНІ вимагають модуля. Для екранів і сцен, не для логіки. */
export function jurisdictionsWithTill(): string[] {
  return Object.keys(TILL_FISCAL);
}
