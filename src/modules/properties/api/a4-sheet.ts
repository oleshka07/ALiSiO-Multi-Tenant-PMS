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
