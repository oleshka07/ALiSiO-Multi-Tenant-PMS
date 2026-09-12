import { listRegistrations, registerGuest, removeRegistration, setPrimaryGuest } from '@bookings';
export const GET = listRegistrations;
export const POST = registerGuest;
export const DELETE = removeRegistration;
export const PATCH = setPrimaryGuest;
