import { fixServiceOrderPayment, getPendingOrders } from '@bookings/fix-payment.handlers';
export const GET = getPendingOrders;
export const POST = fixServiceOrderPayment;
