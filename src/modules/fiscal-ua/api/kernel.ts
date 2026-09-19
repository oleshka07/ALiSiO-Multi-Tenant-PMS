/**
 * @fiscal-ua/kernel — двері, у які стукає ЯДРО, і нічого зайвого.
 *
 * Окремо від `index.ts` з однією причиною: фасад модуля тягне маршрути, а
 * маршрути тягнуть `next/server`. Писач оплати (`@invoicing`) живе на
 * асинхронному шві й читається сценами під голим node, тому він заходить
 * сюди, а не в парадні двері цілком.
 *
 * Той самий прийом, що `@companies/kernel` і `@bookings/kernel`.
 */
export { registerTillReceipt, prroJournal } from '../data/prro.repo';
export type { TillReceiptOutcome, PrroOperation } from '../data/prro.repo';
export type { PrroDevice } from '../domain/prro-device';
