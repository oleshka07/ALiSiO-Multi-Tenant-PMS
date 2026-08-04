import { fixServiceOrderPayment, getPendingOrders } from '@bookings/fix-payment.handlers';
import { withPermission } from '@core/auth/session';

// Marks service orders as paid. It never established who was calling, so any
// logged-in user of any hotel could settle any order by id.
export const GET = await withPermission('manage_payments', getPendingOrders);
export const POST = await withPermission('manage_payments', fixServiceOrderPayment);
