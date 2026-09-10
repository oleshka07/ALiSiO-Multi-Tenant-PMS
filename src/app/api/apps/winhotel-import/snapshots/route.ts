// Публічний маршрут: сесії немає за визначенням — агент на сервері готелю
// доводить право токеном (src/proxy.ts, src/apps/winhotel-import/api).
import { receiveSnapshot } from '@/apps/winhotel-import/api/snapshots.handlers';

export const POST = receiveSnapshot;
