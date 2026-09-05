/**
 * @properties/kernel — двері обʼєкта для сусідніх модулів, без HTTP.
 *
 * Та сама причина, що в `@invoicing/kernel`: `api/index.ts` тягне
 * обробники, а з ними `next/server`, і сцена сусіднього модуля під голим
 * node (`reservation-write.repo.check.ts`) перестала б запускатись.
 *
 * Тут лише чисті функції над даними обʼєкта. Нічого, що приймає `Request`.
 */

/**
 * Стан прибирання номера з журналом (0092). Виселення в `@bookings` бруднить
 * номер цією функцією під ТІЄЮ САМОЮ ручкою транзакції, що й статус броні.
 */
export { setCleaningStatus, housekeepingBoard, cleaningHistory, CLEANING_STATUSES } from '../data/cleaning.repo';
export type { CleaningStatus, CleaningChange } from '../data/cleaning.repo';
