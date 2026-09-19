// QR обʼєкта як PNG — те саме зображення, що поїде на аркуш A4.
// Один генератор на екран і на друк: два розійшлися б, і оператор перевірив
// би телефоном один код, а надрукував інший.
import { guestAppQr } from '@/apps/guest-app/api/admin.handlers';

export const GET = guestAppQr;
