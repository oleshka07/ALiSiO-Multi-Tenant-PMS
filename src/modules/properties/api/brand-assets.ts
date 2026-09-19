/**
 * Зображення обʼєкта за ролями — вузькі двері назовні.
 *
 * Двері, а не повний фасад `@properties/kernel`, з тієї ж причини, що
 * `@bookings/checkin-policy`: ці функції читає `apps/guest-app/data/
 * property.repo.ts`, а його вантажить `guest-app.check.ts` ГОЛИМ node.
 * Повний фасад тягне обробники маршрутів, ті — `next/server`, і сцена падає
 * з ERR_MODULE_NOT_FOUND ще до першого твердження (`check-entry-imports`,
 * `check-bare-node`).
 */
export { brandAssetsOf, setBrandAsset } from '../data/brand-assets.repo';
