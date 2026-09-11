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

/**
 * Чи вільні ці номери на ВЕСЬ діапазон — єдине джерело відповіді про
 * наявність (інваріант И3). У kernel, а не лише в `@properties`, з тієї самої
 * причини, що `setCleaningStatus`: фасад тягне обробники й `next/server`, а
 * `@bookings` питає це з `assignUnit`, чия сцена бігає під голим node.
 */
export { freeUnitsForRange } from '../data/availability';

/**
 * Код скриньки для номера, призначеного ЦІЙ броні на ЦЬОМУ обʼєкті —
 * навмисний виняток із правила «секрети номера лише під manage_properties»
 * (Блок «Кіоск» §3.2 крок 5). Межі винятку — у шапці самої функції.
 */
export { lockCodeForStay } from '../data/units.repo';

/**
 * Чи цей обʼєкт справді цієї організації. Двері для застосунків, які
 * приймають `propertyId` ззовні: id приходить із тіла запиту, і без цієї
 * перевірки код парування виписався б на будинок сусіднього рахунку
 * (інваріант 5 — чужий id відповідає «немає»).
 */
export { ownsProperty } from '../data/tenant-scope';
