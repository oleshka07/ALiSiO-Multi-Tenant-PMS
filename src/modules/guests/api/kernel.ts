/**
 * @guests/kernel — двері гостей для сусідів і застосунків, без HTTP.
 *
 * Та сама причина, що в `@invoicing/kernel` і `@properties/kernel`:
 * `api/index.ts` тягне обробники, а з ними `next/server`, тож сцена під
 * голим node (`src/apps/kiosk/kiosk.check.ts`) не піднялась би.
 */

/**
 * Підпис пальцем під реєстрацією (К3, 0146). Єдині двері: перевірка форми
 * і розміру стоїть за ними, а не в кожному писачі.
 */
export { saveSignature, isSigned, SIGNATURE_MAX_BYTES } from '../data/signature.repo';
export type { SignatureAnswer, SignatureRefusal } from '../data/signature.repo';

/** Реєстрація гостей — та сама, якою пише портал і рецепція. */
export { saveRegistrations } from '../data/registration.repo';
