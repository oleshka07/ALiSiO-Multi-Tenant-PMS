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
 * Тримає `writer-imports.check.ts`: він вантажить ті самі писачі з гачком,
 * який відмовляє на `next/server`, тобто відтворює прод-образ на стенді.
 *
 * Що сюди можна класти: читання, які потрібні писачам і скриптам. Що не
 * можна: будь-що, що тягне `next/server`, `NextResponse` чи варти сесії.
 */

export { listRatePlans } from '../data/rate-plans.repo';
export { propertyRatePlans } from '../data/property-rate-plans';
export { pricedDaysAhead } from '../data/price-calendar.repo';
