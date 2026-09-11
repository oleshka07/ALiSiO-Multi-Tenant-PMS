// Картка застосунку: відкликати термінал. Рядок лишається — разом із ним
// лишається журнал доби, яку він відпрацював. Варта власника.
import { revokeKioskDevice } from '@/apps/kiosk/api/admin.handlers';

export const POST = revokeKioskDevice;
