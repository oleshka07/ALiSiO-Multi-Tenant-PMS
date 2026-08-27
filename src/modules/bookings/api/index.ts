// Bookings module public API — v2
export { listReservations, createReservation } from './reservations.handlers';
export { getReservation, updateReservation, deleteReservation } from './reservation.handlers';
export { listActivity, createActivity } from './reservation-activity.handlers';
export { listRegistrations, registerGuest, removeRegistration } from './reservation-registrations.handlers';
// Sub-bookings: одна бронь, кілька номерів. Тут стояли ще шість експортів
// групових броней із приміткою «legacy, буде видалено» — видалено 2026-08-27
// разом із таблицею `reservation_groups` (міграція 0039).
export { listSubBookings, createSubBooking, updateSubBooking, deleteSubBooking } from './sub-bookings.handlers';
export { listBookingSources, createBookingSource } from './booking-sources.handlers';
export { updateBookingSource, deleteBookingSource } from './booking-source.handlers';
export { listWidgetSiteSources } from './booking-source-widgets.handlers';
export { listAdditionalServices, createAdditionalService, updateAdditionalService, deleteAdditionalService } from './additional-services.handlers';
export { listAvailabilityBlocks, createAvailabilityBlock, deleteAvailabilityBlock } from './availability-blocks.handlers';
export { listServiceOrders, updateServiceOrder } from './service-orders.handlers';
// Used by the widget module when a booking is completed.
export { sendBookingConfirmationEmail } from '../data/send-confirmation-email';
export { registerBookingsSubscribers } from '../events/subscribers';

// The four sheets reception prints every morning.
export { getDaySheet } from './day-sheets.handlers';
export type { StayRow, BreakfastRow, KeyRow, DayCloseRow } from '../data/day-sheets.repo';
