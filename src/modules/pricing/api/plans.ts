/**
 * Вузькі двері модуля цін для ПИСАЧІВ і фонових скриптів.
 *
 *   import { listRatePlans } from '@pricing/plans';
 *
 * Окремий файл фасаду, а не `@pricing` цілком, — з тієї самої причини, що й
 * `@channels/outbox`: повний фасад тягне за собою обробники HTTP, а вони
 * імпортують `next/server`, якого в продакшн-образі НЕМАЄ. Next збирає
 * standalone і вирізає з `node_modules` усе, чого не просить рантайм
 * застосунку, тож `node_modules/next/server.js` там просто відсутній.
 *
 * Чим це коштувало. `deploy.sh` після підняття контейнера звіряє готельні
 * файли — `docker exec … node scripts/apply-hotel.mjs --all`. Скрипт імпортує
 * писачі (`properties/data/units.repo`, `pricing/data/occupancy-price.repo`),
 * ті йдуть у `@channels/outbox`, а `channels/data/outbox-notes.ts` тягнув
 * `@pricing` — і ланцюжок упирався в `next/server`. Застосунок при цьому
 * піднімався і віддавав усі чотири димові відповіді: падав КРОК ПІСЛЯ нього,
 * тож деплой звітував «не пройшов», хоча бета вже працювала на новому коміті
 * (06.09.2026, деплої 8cdbddc і 8cbefeb).
 *
 * Тримає `scripts/check-entry-imports.mjs`: він піднімає КОЖЕН вхід, який
 * запускають у прод-образі (`apply-hotel` серед них), із гачком, що
 * відмовляє на `next/*`. Раніше це був `writer-imports.check.ts` — він
 * вантажив саме писачів і рівно їх, тож наступний випадок того самого класу
 * (живий прохід ARI) пройшов повз нього.
 *
 * Що сюди можна класти: читання, які потрібні писачам і скриптам. Що не
 * можна: будь-що, що тягне `next/server`, `NextResponse` чи варти сесії.
 */

export { listRatePlans } from '../data/rate-plans.repo';
// Чи може ЦЕЙ платник купити ЦЕЙ тариф (INC-205). Сюди — бо писач броні
// мусить ставити те саме питання, що й котирування, і саме ЦИМ запитом:
// два власні прочитання одного правила розійдуться, і розійдуться тихо.
export { assertRatePlanForPayer } from '../data/company-rate-plans.repo';
export { propertyRatePlans } from '../data/property-rate-plans';
export { pricedDaysAhead } from '../data/price-calendar.repo';
