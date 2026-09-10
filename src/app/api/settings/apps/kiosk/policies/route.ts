// Картка застосунку: політики обʼєкта, за якими живе термінал (0413).
import { getKioskPolicies, saveKioskPolicies } from '@/apps/kiosk/api/admin.handlers';

export const GET = getKioskPolicies;
export const PUT = saveKioskPolicies;
