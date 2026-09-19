/**
 * Аркуш A4 із QR — вузькі двері назовні.
 *
 * Зміст (`buildSheet`) і малювання (`renderSheetPdf`) розділені й тут: перше
 * чиста функція, яку перевіряє `a4-sheet.check` без розтеризації сторінки,
 * друге тягне `pdfkit` і має сенс лише в маршруті.
 */
export { buildSheet, sheetUrl } from '../domain/a4-sheet';
export type { SheetContent, SheetOverrides, SheetProperty } from '../domain/a4-sheet';
export { renderSheetPdf } from '../domain/a4-sheet-pdf';

// Контакти рецепції — тими самими дверима, бо їх читає той самий маршрут
// аркуша і більше ніхто. Окремий файл дверей на дві функції означав би
// третій шлях у той самий модуль.
export { receptionContact, whatsappLink } from '../data/reception.repo';
export type { ReceptionContact } from '../data/reception.repo';
