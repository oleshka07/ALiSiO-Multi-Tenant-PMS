// Аркуш A4 із QR — PDF. POST, бо тіло несе разові правки оператора
// (телефон рецепції, свій заклик), які нікуди не зберігаються.
import { guestAppSheet } from '@/apps/guest-app/api/admin.handlers';

export const POST = guestAppSheet;
