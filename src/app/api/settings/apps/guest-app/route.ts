// Картка застосунку «Гостьовий застосунок»: перелік будинків і видача ключа.
// Під вартою власника рахунку — це екран налаштувань, не публічна поверхня.
import { listGuestAppHouses, issueGuestAppKey } from '@/apps/guest-app/api/admin.handlers';

export const GET = listGuestAppHouses;
export const POST = issueGuestAppKey;
