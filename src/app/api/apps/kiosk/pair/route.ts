// Публічний маршрут: сесії немає за визначенням — у холі стоїть екран, а не
// людина з паролем. Право доводить шестизначний код парування, який адмін
// щойно бачив на картці (src/proxy.ts, src/apps/kiosk/api).
import { pairDevice } from '@/apps/kiosk/api/pairing.handlers';

export const POST = pairDevice;
