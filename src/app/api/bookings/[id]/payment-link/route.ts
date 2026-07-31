import { createReservationPaymentLink } from '@payments';
import { withPermission } from '@core/auth/session';

// Creates a payment link for a reservation named in the URL.
export const POST = withPermission('manage_payments', createReservationPaymentLink);
