import { draftsCount } from '@bookings';

/**
 * Бейдж чернеток. Запит і його довід — `modules/bookings/api/drafts-count`:
 * лічильник мусить збігатися зі списком, на який веде клік, тож живе поруч
 * із ним, а не тут.
 */
export const GET = draftsCount;

export const runtime = 'nodejs';
