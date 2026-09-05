/**
 * @housekeeping — борд прибирання та історія (Блок 4 §2.2). Ядро, без ключа.
 *
 * Стан номера і журнал належать обʼєкту (`@properties`); цей модуль — екран,
 * варта й розбір запиту над ними. Пише SQL він не має куди.
 */
export { getHousekeepingBoard, getCleaningHistory, setUnitCleaningStatus } from './housekeeping.handlers';
