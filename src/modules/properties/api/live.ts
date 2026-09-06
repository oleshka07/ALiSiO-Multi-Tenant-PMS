/**
 * Двері модуля обʼєктів для ВХОДІВ, які запускають у прод-образі.
 *
 *   import { catalogUnitTypes } from '@properties/live';
 *
 * Причина та сама, що в `@channels/live`: повний фасад `@properties` тягне
 * `properties.handlers.ts`, той — `next/server`, а Next standalone вхідних
 * точок `next/*` не містить. Живі проходи Channex і інструменти оператора
 * виконуються всередині контейнера.
 *
 * Лише реекспорт із шару даних. Нового коду тут не буває.
 */
export { availabilityByDay } from '../data/availability';
export { catalogProperty, catalogUnitTypes } from '../data/property-catalog';
