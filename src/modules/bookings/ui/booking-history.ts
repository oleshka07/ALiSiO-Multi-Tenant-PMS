/**
 * Клієнтські двері історії броні — лише чистий домен.
 *
 * `@bookings/history` тягне за собою репозиторій, а з ним `@core/db/async` →
 * `src/lib/db.ts` → `next/headers` і `node:module`: у клієнтському компоненті
 * така збірка падає (Turbopack: «You're importing a module that depends on
 * next/headers»; CI-запуск 475, 03.09.2026). `tsc` цього не бачить — типи
 * сходяться, ламається лише чанк браузера. Тому картка броні читає різницю
 * знімків звідси: файл без єдиного серверного імпорту, і саме такий шлях
 * (`modules/<mod>/ui/…`) `check-boundaries` вважає парадними дверима для
 * React.
 */
export { describeChanges, changesToText } from '../domain/booking-history';
export type { ChangeLine, BookingSnapshot } from '../domain/booking-history';
