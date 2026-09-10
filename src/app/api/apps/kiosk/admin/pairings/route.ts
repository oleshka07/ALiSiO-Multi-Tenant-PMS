// Картка застосунку: код парування нового термінала. Під вартою власника —
// сегмент `admin/` навмисно виведений з-під публічного переліку гейтів
// (scripts/check-route-guards.mjs), тож відсутність варти тут валить збірку.
import { createDevicePairing } from '@/apps/kiosk/api/admin.handlers';

export const POST = createDevicePairing;
