/**
 * @fiscal-ua — фіскалізація України (ПРРО). Модуль ЮРИСДИКЦІЇ, не ядро.
 *
 * ── Чому окремий модуль, а не гілка в фактуруванні ──────────────────────
 *
 * П8 (docs/DECISIONS.md, 31.08.2026): продукт робиться для Європи І України
 * одночасно, і все специфічне для однієї країни живе окремим ключем реєстру,
 * увімкненим лише тим, кому потрібне. Інваріант 22 називає межу словами:
 * якщо правило можна пояснити, не називаючи країну, — це ядро; якщо не
 * можна — це модуль. «Рядок чека поза базою ПДВ» пояснюється без країни і
 * живе в ядрі (`collected_for = 'authority'`, `kind = 'city_tax'`). «Рядок
 * 11 фіскального чека» без країни не пояснюється — і живе тут.
 *
 * ── Межа ────────────────────────────────────────────────────────────────
 *
 * ТУТ: `prro_settings` (реквізити каси обʼєкта), `prro_operations` (реєстр
 * чеків і журнал збоїв), інтерфейс пристрою і його драйвери.
 *
 * НЕ ТУТ: фоліо, рядки, оплати, ПДВ — це `@invoicing`, і жодного запиту до
 * його таблиць звідси немає. Рядки приходять параметром від власника.
 *
 * ── Чого тут немає СЬОГОДНІ ─────────────────────────────────────────────
 *
 * Провайдера. Його не обрано (чекпоінт власника —
 * docs/research/prro-providers.md), і драйвери, які є, з мережею не
 * розмовляють: `none` відмовляє названо, `test` відповідає детерміновано.
 * HTTP зʼявиться разом із вибором, і — інваріант 28 — писатиметься проти
 * ЖИВИХ відповідей, а не проти документації.
 */
export { getFiscalUaSettings, saveFiscalUaSettings, testFiscalUaDevice } from './fiscal-ua.handlers';
export { registerTillReceipt } from '../data/prro.repo';
export type {
  PrroSettings, PrroOperation, PrroOperationKind, PrroOperationStatus, TillReceiptOutcome,
} from '../data/prro.repo';
export type {
  PrroDevice, PrroDriver, PrroReceipt, PrroReceiptLine, PrroReceiptResult,
  PrroShift, PrroZReport,
} from '../domain/prro-device';
export { PRRO_DRIVERS } from '../domain/prro-device';
