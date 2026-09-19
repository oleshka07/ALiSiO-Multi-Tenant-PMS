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
 *   QR 105 мм — аркуш вішають на скло, а правило читача «сторона ≈ відстань
 *     / 10»: 105 мм читаються з метра, тобто гість не мусить нахилятись.
 *     Перша редакція мала 95 мм і лишала під колонками порожню смугу —
 *     код, який і так головний на аркуші, займав менше місця, ніж поля;
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

const QR_SIDE_MM = 105;
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

/** Сірі тони. Один набір на весь аркуш — щоб «трохи інший сірий» не завівся. */
const INK = '#1a1a1a';
const MUTED = '#6b6b6b';
const HAIRLINE = '#d8d8d8';
const PANEL = '#f4f4f2';

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
  const centre = { width, align: 'center' as const };

  // ── Шапка: хто це ──────────────────────────────────────────────────────
  //
  // Назва готелю дрібно й у розрядку — вона тут не головна. Головне — ДІЯ,
  // і вона нижче великим кеглем: аркуш висить на склі, і з двох метрів має
  // читатися «що мені зробити», а не «як зветься будинок».
  let y = mm(MARGIN_MM);
  if (logo) {
    try {
      doc.image(logo, left + (width - mm(50)) / 2, y, { fit: [mm(50), mm(16)], align: 'center' });
      y += mm(18);
    } catch { /* нечитане лого — далі назвою */ }
  }
  doc.font('bold').fontSize(10).fillColor(MUTED)
    .text(sheet.hotelName.toUpperCase(), left, y, { ...centre, characterSpacing: 2 });
  y = doc.y + mm(2);

  // ── Дія ────────────────────────────────────────────────────────────────
  doc.font('bold').fontSize(34).fillColor(INK)
    .text(sheet.title.toUpperCase(), left, y, { ...centre, characterSpacing: 0.5 });
  y = doc.y + mm(1.5);

  if (sheet.subtitle) {
    doc.font('body').fontSize(11).fillColor(MUTED).text(sheet.subtitle, left, y, centre);
    y = doc.y + mm(3);
  }

  // Коротка риска під заголовком — вона ділить «хто ми» і «що робити».
  doc.moveTo(left + width / 2 - mm(18), y).lineTo(left + width / 2 + mm(18), y)
    .lineWidth(2).strokeColor(INK).stroke();
  y += mm(7);

  // ── QR у рамці ─────────────────────────────────────────────────────────
  const qrSide = mm(QR_SIDE_MM);
  const qrX = left + (width - qrSide) / 2;
  const pad = mm(5);
  doc.roundedRect(qrX - pad, y - pad, qrSide + pad * 2, qrSide + pad * 2, mm(3))
    .lineWidth(1).strokeColor(HAIRLINE).stroke();
  doc.image(qr, qrX, y, { width: qrSide, height: qrSide });
  y += qrSide + pad + mm(4);

  // Адреса текстом: у кого не спрацювала камера — набирає руками. І видно,
  // що код веде САМЕ СЮДИ, а не кудись іще.
  doc.font('body').fontSize(10).fillColor(MUTED).text(sheet.url, left, y, centre);
  y = doc.y + mm(8);

  // ── Колонки мов ────────────────────────────────────────────────────────
  //
  // Головна правка проти першої редакції: мови стоять ПОРУЧ, кожна під
  // своїм підписом. Рядками одна під одною друга мова читалась як примітка
  // до першої, і власник її просто не побачив.
  const cols = sheet.blocks.length;
  const gap = mm(8);
  const colWidth = (width - gap * (cols - 1)) / cols;
  const colTop = y;
  let colBottom = y;

  sheet.blocks.forEach((block, i) => {
    const x = left + i * (colWidth + gap);
    let cy = colTop;

    doc.font('bold').fontSize(9).fillColor(INK)
      .text(block.langName.toUpperCase(), x, cy, { width: colWidth, characterSpacing: 1.5 });
    cy = doc.y + mm(1);
    doc.moveTo(x, cy).lineTo(x + colWidth, cy).lineWidth(1).strokeColor(HAIRLINE).stroke();
    cy += mm(3);

    doc.font('bold').fontSize(10.5).fillColor(INK).text(block.lead, x, cy, { width: colWidth });
    cy = doc.y + mm(2.5);

    for (const bullet of block.bullets) {
      // Крапка малюється окремо: `•` у рядку з'їхав би разом із переносом,
      // а так текст має рівний лівий край під будь-яку довжину мітки.
      doc.circle(x + mm(1.4), cy + mm(1.7), mm(0.9)).fillColor(INK).fill();
      const tx = x + mm(4.5);
      const tw = colWidth - mm(4.5);
      doc.font('bold').fontSize(9.5).fillColor(INK)
        .text(bullet.label, tx, cy, { width: tw, continued: true })
        .font('body').fillColor(INK).text(` ${bullet.text}`, { width: tw });
      cy = doc.y + mm(2);
    }

    doc.font('body').fontSize(8.5).fillColor(MUTED).text(block.tail, x, cy + mm(1), { width: colWidth });
    colBottom = Math.max(colBottom, doc.y);
  });

  // ── Підвал: допомога і документ ────────────────────────────────────────
  //
  // Знизу сторінки, а не «після колонок»: аркуш має однаковий вигляд і в
  // готелю з довгими німецькими рядками, і з короткими англійськими.
  const idY = doc.page.height - mm(MARGIN_MM) - mm(4);
  const panelH = mm(24);
  const panelY = idY - mm(6) - panelH;

  if (sheet.phone) {
    doc.roundedRect(left, panelY, width, panelH, mm(3)).fillColor(PANEL).fill();
    doc.font('body').fontSize(8.5).fillColor(MUTED)
      .text(sheet.helpLabel, left + mm(8), panelY + mm(4), { width: width - mm(16) });
    doc.font('bold').fontSize(20).fillColor(INK)
      .text(sheet.phone, left + mm(8), panelY + mm(9), { width: width - mm(16) });
    doc.font('body').fontSize(8.5).fillColor(MUTED)
      .text(sheet.helpRole, left + mm(8), panelY + mm(18), { width: width - mm(16) });
  }

  doc.font('body').fontSize(8).fillColor(MUTED).text(sheet.idNote, left, idY, centre);

  // Хвіст ключа й дата, найдрібнішим: знайшли старий аркуш на складі —
  // видно, чи він іще чинний (заміна ключа вбиває надруковані, КІ35).
  doc.fontSize(6.5).fillColor('#aaaaaa')
    .text(`${sheet.address || sheet.hotelName} · …${sheet.keyTail} · ${sheet.printedOn}`,
      left, idY + mm(4), centre);

  doc.end();
  return done;
}
