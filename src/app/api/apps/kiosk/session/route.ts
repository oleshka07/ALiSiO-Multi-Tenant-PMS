// Публічний маршрут: право доводить токен пристрою в Authorization: Bearer
// (src/apps/kiosk/data/device-token.ts). Віддає лише те, що термінал знає до
// того, як гість назвався: обʼєкт, мови, політики, робоча смуга.
import { deviceSession } from '@/apps/kiosk/api/session.handlers';

export const GET = deviceSession;
