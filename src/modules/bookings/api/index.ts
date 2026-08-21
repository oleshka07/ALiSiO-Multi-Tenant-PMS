// Bookings module public API — v2
export { listReservations, createReservation } from './reservations.handlers';
export { getReservation, updateReservation, deleteReservation } from './reservation.handlers';
export { listActivity, createActivity } from './reservation-activity.handlers';
export { listRegistrations, registerGuest, removeRegistration } from './reservation-registrations.handlers';
// Legacy group bookings — kept for backward compat during migration, will be deleted
export { listGroupBookings, createGroupBooking } from './group-bookings.handlers';
export { getGroupBooking, updateGroupBooking, deleteGroupBooking } from './group-booking.handlers';
export { assignGuest } from './group-booking-assign.handlers';
// Sub-bookings (replaces group bookings)
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
