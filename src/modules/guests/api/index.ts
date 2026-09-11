// Guests module public API
import { NextResponse } from 'next/server';
import { withGuestReservation } from '../data/guest-scope';
import { getGuestPortal as _getGuestPortal } from './portal.handlers';
import { registerGuests as _registerGuests } from './register.handlers';
import { submitFeedback as _submitFeedback } from './feedback.handlers';
import { orderServices as _orderServices } from './services.handlers';
import { handleCartEvent as _handleCartEvent } from './cart.handlers';
import { requestPayment as _requestPayment } from './payment-request.handlers';

export { listGuests, createGuest, exportGuests } from './guests.handlers';
export { getGuest, updateGuest, deleteGuest } from './guest.handlers';

/**
 * The guest portal's guard: resolve the link's token, then run as that hotel.
 *
 * Every handler below already looks the reservation up by token itself. That
 * lookup is scoped like everything else, so with no organization set it matched
 * nothing and the entire portal answered 404 — its own booking, invisible to
 * the guest holding the link. This resolves the tenant first, from the one row
 * the token names, and the handlers then work unchanged.
 *
 * A token that names nothing gives 404, and so does a token whose reservation
 * has no organization. Same answer either way: a different one would tell a
 * stranger which tokens exist.
 */
type GuestCtx = { params: Promise<{ token: string }> };
function withGuest<R>(handler: (request: any, context: GuestCtx) => Promise<R>) {
  return async (request: any, context: GuestCtx) => {
    const { token } = await context.params;
    const answer = await withGuestReservation(token, () => handler(request, context));
    return answer ?? NextResponse.json({ error: 'Not found' }, { status: 404 });
  };
}

export const getGuestPortal   = withGuest(_getGuestPortal);
export const registerGuests   = withGuest(_registerGuests);
export const submitFeedback   = withGuest(_submitFeedback);
export const orderServices    = withGuest(_orderServices);
export const handleCartEvent  = withGuest(_handleCartEvent);
export const requestPayment   = withGuest(_requestPayment);
export { getRegistry, updateRegistryEntry, exportRegistry } from './registry.handlers';
export { getMeldeschein } from './meldeschein.handlers';
export { listGuestPageSections, updateGuestPageSections, getGuestPagePreview } from './guest-page-sections.handlers';


// Domain types
export type { GuestWithStats, CreateGuestInput, RegisteredGuest } from '../domain/types';

// Unified dedup helper — call from any handler that creates/finds a guest
// (manual booking, group booking, channel sync, Excel import, email parser).
// Strategy: email → phone → first+last name (case-insensitive), all scoped
// to organization_id. Soft-merges new fields without overwriting existing ones.
export { findOrCreateGuest } from '../data/guest-dedup.repo';
export type { GuestDedupArgs, GuestDedupResult } from '../data/guest-dedup.repo';

// А це — для тих, хто гостя НЕ вгадує, а дає людині обрати зі списку
// (форма броні). Названий id береться як названий і не звіряється з
// ланцюжком: остання ланка дедупу — збіг за самим іменем, тож двоє
// однофамільців для нього одна людина. Чужий і злитий id — названі відмови,
// не мовчазна підміна (`booking-guest.repo`, гейт `booking-guest.check`).
export { resolveBookingGuest } from '../data/booking-guest.repo';
export type { BookingGuestArgs, BookingGuestResult } from '../data/booking-guest.repo';

// Згоди GDPR живуть на ОСОБІ й переживають бронь (INC-300, CORE-GAPS п. 6).
// `guest_registrations.consent_*` лишається і значить інше — згоду на ЦЬОМУ
// перебуванні, частину Meldeschein. Через місяць вони виглядатимуть як
// дублікати: перше зруйнує Meldeschein, друге — доказ згоди.
//
// Колонки `guests.marketing_opt_in` навмисно немає: «чи можна слати листи» —
// похідне від журналу (`marketingAllowed`), бо два джерела розійдуться.
export {
  recordConsent, revokeConsent, consentState, marketingAllowed,
} from '../data/guest-consents.repo';
export type { ConsentKind, ConsentSource, ConsentRow, RecordConsentInput }
  from '../data/guest-consents.repo';

// Злиття дублікатів гостя (INC-300, CORE-GAPS п. 11). Дублікатів наробляє
// портьє щодня, тож це ядро, а не імпортна обслуга. Злитий рядок не
// видаляється — `merged_into` лишає його розвʼязним до живої людини.
export { mergeGuests } from '../data/guest-merge.repo';
export type { MergeGuestsInput, MergeGuestsResult } from '../data/guest-merge.repo';

// Дублікати в руках портьє (INC-304): список пар із причиною, попередній
// перегляд «що переїде» і рішення «та сама людина» / «різні люди».
export { listDuplicates, previewDuplicateMerge, decideDuplicate } from './duplicates.handlers';
export { previewMerge, markNotDuplicates } from '../data/guest-merge.repo';

// «Схоже, це одна людина» — ПРОПОЗИЦІЯ злиття, ніколи не саме злиття
// (INC-303). Пошта працює лише в парі з імʼям: сімʼя під однією поштою — не
// одна людина, і правило IMPORT-PLAN §2.7 («однаковий E_MAIL → один гість»)
// злило б подружжя з дітьми.
export { guestDuplicateCandidates, searchName, STRONG_TIERS } from '../data/guest-duplicates.repo';
export type { DuplicateCandidate, DuplicateTier } from '../data/guest-duplicates.repo';

// Згоди Winhotel → наші таблиці (INC-302). Редакція береться з АДРЕСИ
// (`ADRESSEN.DS_VERSION`), бо в довіднику пунктів колонки версії немає взагалі;
// згода, чиєї редакції в базі немає, іде в карантин, а не під нинішній текст.
export { planConsentImport, winhotelRef } from '../domain/consent-import';
export type { ConsentImportPlan, QuarantinedConsent } from '../domain/consent-import';

// Загальний пошук питає модуль, а не таблицю. Див. core/search-types.ts.
export { searchGuests } from '../data/guest-search';

// GDPR-ретенція: обидва крон-маршрути (guests/gdpr-cron і cron/gdpr-retention)
// кличуть одну реалізацію, і саме через фасад — щоб маршрут не відкривав
// нутрощі модуля.
// Зміст гостьової сторінки, зібраний з трьох рівнів (обʼєкт → тип → номер).
// Двері потрібні власнику таблиці `guest_page_config`: його перевірка рівнів
// має кликати резолвер, не заглядаючи в нутрощі модуля.
export { getGuestPageConfig } from '../data/guest-portal.repo';

// Що ретенція робить із кожною таблицею, яка тримає дані гостя (INC-305).
// Реєстр — дані, і повноту стереже `check-retention-tables`: нова таблиця
// мусить бути названа, бо мовчазний пропуск — це персональні дані, які
// пережили термін зберігання.
export { RETENTION_ANONYMISED, RETENTION_DELETED, RETENTION_KEPT } from '../domain/retention-tables';

export { anonymizeOldRegistrations } from '../data/registration.repo';
export type { RetentionRunResult } from '../data/registration.repo';

// Реєстрація з картки броні — той самий писач обох книг гостей, що й портал
// (Д16): картка в @bookings не пише таблиці гостей сама.
export { addReceptionRegistration, removeReceptionRegistration,
  // Заявник — той, чиїм прізвищем підписаний Meldeschein за все
  // перебування, тож його зміна — писач цього модуля, а не `UPDATE`
  // з картки броні (Д16, гейт `primary-registration.check`).
  setPrimaryRegistration } from '../data/registration.repo';
export type { ReceptionGuestSnapshot } from '../data/registration.repo';
