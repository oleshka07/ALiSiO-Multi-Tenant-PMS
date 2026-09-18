/**
 * Малювання аркуша A4. ЗМІСТ — у `a4-sheet.ts`, тут лише геометрія.
 *
 * Розділено навмисно: твердження «код веде туди, куди підпис» перевіряється
 * на змісті (`a4-sheet.check`), без розтеризації сторінки. Тут лишається те,
 * що доводиться лише очима й лінійкою.
 *
 * ── Числа, від яких залежить, чи код узагалі відсканується ──────────────
 *
 * Не оформлення. Кожне — місце, де QR перестає читатися МОВЧКИ:
 *
 *   QR 95 мм — аркуш вішають на скло, а правило читача «сторона ≈ відстань
 *     / 10»: 95 мм читаються з ~95 см, тобто гість не мусить нахилятись;
 *   `margin: 4` — тиха зона. У `invoice-pdf-de.ts` стоїть `margin: 0`, бо
 *     там код у власній рамці; скопійований сюди, він забирає в частини
 *     читачів здатність побачити код узагалі;
 *   `errorCorrectionLevel: 'M'` — H потрібен лише під накладене лого. Лого
 *     всередині коду ми не ставимо, а M дає рідшу сітку, яку гірша камера
 *     бере впевненіше;
 *   ЧОРНИЙ НА БІЛОМУ завжди, навіть коли в готелю є палітра (0419). Читачу
 *     потрібен контраст; бірюзовий код на піщаному тлі проходить у салоні й
 *     не проходить у холі надвечір. Бренд живе в шапці, не в коді.
 */
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { SheetContent } from './a4-sheet.ts';

/** Міліметри в точки PDF. */
const mm = (v: number) => (v * 72) / 25.4;

const QR_SIDE_MM = 95;
const MARGIN_MM = 18;

const FONTS = path.join(process.cwd(), 'src/assets/fonts');

/**
 * Зображення з нашого ж сховища у буфер.
 *
 * Лише власні шляхи (`/uploads/…`): адресу перевірив `readBrandLogoUrl`, але
 * зовнішній `https` тут означав би похід у мережу під час друку — тобто
 * аркуш, який іноді збирається, а іноді ні. Немає файла — друкуємо без
 * зображення, а не падаємо: аркуш без лого лишається робочим аркушем.
 */
function localImage(url: string | null): Buffer | null {
  if (!url || !url.startsWith('/')) return null;
  try {
    const file = path.join(process.cwd(), 'public', url.replace(/^\/+/, ''));
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  } catch { return null; }
}

export async function renderSheetPdf(sheet: SheetContent): Promise<Buffer> {
  // QR — ДО створення документа: API `qrcode` асинхронний, а малювання в
  // pdfkit синхронне (той самий порядок, що в німецькій фактурі).
  const qr = await QRCode.toBuffer(sheet.qrPayload, {
    margin: 4,
    width: 1200,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#FFFFFF' },
  });
  const logo = localImage(sheet.logoUrl);
  const cover = localImage(sheet.coverUrl);

  const doc = new PDFDocument({ size: 'A4', margin: mm(MARGIN_MM) });
  doc.registerFont('body', path.join(FONTS, 'DejaVuSans.ttf'));
  doc.registerFont('bold', path.join(FONTS, 'DejaVuSans-Bold.ttf'));

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const left = mm(MARGIN_MM);
  const width = doc.page.width - mm(MARGIN_MM) * 2;

  // ── Шапка: лого або назва ──────────────────────────────────────────────
  if (logo) {
    try { doc.image(logo, left, mm(MARGIN_MM), { fit: [mm(60), mm(20)] }); }
    catch { doc.font('bold').fontSize(22).text(sheet.hotelName, left, mm(MARGIN_MM)); }
  } else {
    doc.font('bold').fontSize(22).text(sheet.hotelName, left, mm(MARGIN_MM));
  }
  doc.y = mm(MARGIN_MM + 24);

  // ── Заклик, мовою готелю ───────────────────────────────────────────────
  const first = sheet.blocks[0];
  doc.font('bold').fontSize(19).text(first.headline, left, doc.y, { width, align: 'center' });
  doc.moveDown(0.6);

  // ── QR ─────────────────────────────────────────────────────────────────
  const qrSide = mm(QR_SIDE_MM);
  const qrX = left + (width - qrSide) / 2;
  doc.image(qr, qrX, doc.y, { width: qrSide, height: qrSide });
  doc.y += qrSide + mm(4);

  // Адреса текстом. Гість, у якого не спрацювала камера, набирає її руками;
  // і видно, що код веде саме сюди, а не кудись іще.
  doc.font('body').fontSize(12).text(sheet.url, left, doc.y, { width, align: 'center' });
  doc.moveDown(0.8);

  // ── Кроки, обома мовами ────────────────────────────────────────────────
  for (const block of sheet.blocks) {
    if (block !== first) {
      doc.font('bold').fontSize(13).text(block.headline, left, doc.y, { width, align: 'center' });
    }
    doc.font('body').fontSize(11)
      .text(block.steps.join('   ·   '), left, doc.y, { width, align: 'center' });
    doc.fontSize(9).text(block.note, left, doc.y, { width, align: 'center' });
    doc.moveDown(0.5);
  }

  // ── Обкладинка, якщо є і якщо лишилось місце ──────────────────────────
  //
  // Порядок саме такий: QR і адреса стоять ВИЩЕ за картинку. Аркуш без
  // обкладинки робить свою роботу; аркуш без коду — ні.
  const footerTop = doc.page.height - mm(MARGIN_MM) - mm(14);
  if (cover && footerTop - doc.y > mm(30)) {
    try {
      doc.image(cover, left, doc.y, { fit: [width, footerTop - doc.y - mm(6)], align: 'center' });
    } catch { /* нечитане зображення не спиняє друк */ }
  }

  // ── Підвал ─────────────────────────────────────────────────────────────
  doc.font('body').fontSize(9).fillColor('#444444');
  const where = [sheet.hotelName, sheet.address, sheet.phone].filter(Boolean).join(' · ');
  doc.text(where, left, footerTop, { width, align: 'center' });
  // Хвіст ключа й дата: знайшли старий аркуш — видно, чи він іще чинний.
  doc.fontSize(7).fillColor('#888888')
    .text(`…${sheet.keyTail} · ${sheet.printedOn}`, left, footerTop + mm(6),
      { width, align: 'center' });

  doc.end();
  return done;
}
