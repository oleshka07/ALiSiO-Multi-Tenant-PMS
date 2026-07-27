import { createBookingDraft, getBookingDraft, deleteBookingDraft, updateBookingDraft, createBookingDraftOptions } from '@bookings/booking-drafts.handlers';
export const POST = createBookingDraft;
export const GET = getBookingDraft;
export const PUT = updateBookingDraft;
export const DELETE = deleteBookingDraft;
export const OPTIONS = createBookingDraftOptions;
