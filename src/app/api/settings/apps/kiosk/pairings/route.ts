// Картка застосунку: код парування нового термінала. Варта власника.
// Живе там, де всі картки застосунків — під `/api/settings/apps/…`, тобто в
// звичайному охоронюваному контурі, а не під публічним префіксом кіоска.
import { createDevicePairing } from '@/apps/kiosk/api/admin.handlers';

export const POST = createDevicePairing;
