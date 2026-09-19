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
  // Другий код — чат. Малюється дрібним у панелі допомоги, тож і рівень
  // корекції вищий: маленький код частіше знімають під кутом і з рук.
  const chatQr = sheet.whatsappUrl
    ? await QRCode.toBuffer(sheet.whatsappUrl, {
      margin: 2, width: 400, errorCorrectionLevel: 'Q',
      color: { dark: '#000000', light: '#FFFFFF' },
    })
    : null;
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
  y += qrSide + pad + mm(9);

  // Адреси текстом під кодом БІЛЬШЕ НЕМАЄ (рішення власника 19.09).
  //
  // У зразку кемпінгу вона є — і там це `alisio.swipescape.eu/checkin`, тобто
  // рядок, який людина справді може набрати. У нас ключ обʼєкта це 16
  // випадкових символів (`…/stay/avstta7hamqxcpva`): набрати його руками
  // однаково ніхто не зможе, тож рядок не був запасним шляхом — він був
  // шумом на видному місці. Куди веде код, доводить `a4-sheet.check`
  // декодуванням, а не підпис на папері.

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
  // Нижнє поле знімається ПЕРЕД підвалом, і це не косметика.
  //
  // pdfkit розриває сторінку сам, щойно текст не вміщається в поле — а
  // підвал ставиться в саме поле навмисно. Перша версія цього блоку дала
  // рівно це: рядок «підготуйте документ» поїхав на ДРУГУ сторінку, і
  // «аркуш A4» друкувався на двох, другий — з одним рядком. Побачив би це
  // той, хто натиснув «друк», а не той, хто писав код.
  doc.page.margins.bottom = 0;

  const idY = doc.page.height - mm(MARGIN_MM) - mm(3);
  const panelH = mm(26);
  const panelY = idY - mm(7) - panelH;

  // Панель є, лише коли є КОМУ дзвонити. Порожня плашка з написом
  // «потрібна допомога?» і без номера — знущання з того, кому вона потрібна.
  if (sheet.phone || chatQr) {
    doc.roundedRect(left, panelY, width, panelH, mm(3)).fillColor(PANEL).fill();

    // Праворуч — код чату; текст звужується рівно на його ширину, щоб
    // довгий номер не заліз під картинку.
    const chatSide = mm(20);
    const chatX = left + width - mm(7) - chatSide;
    if (chatQr) {
      doc.image(chatQr, chatX, panelY + mm(3), { width: chatSide, height: chatSide });
      doc.font('body').fontSize(6.5).fillColor(MUTED)
        .text('WhatsApp', chatX, panelY + mm(23.5), { width: chatSide, align: 'center' });
    }
    const textW = width - mm(16) - (chatQr ? chatSide + mm(4) : 0);

    doc.font('body').fontSize(8.5).fillColor(MUTED)
      .text(sheet.helpLabel, left + mm(8), panelY + mm(4.5), { width: textW });
    doc.font('bold').fontSize(19).fillColor(INK)
      .text(sheet.phone, left + mm(8), panelY + mm(9.5), { width: textW });

    // Роль, ГОДИНИ і адреса одним тихим рядком (0422). Години тут не
    // прикраса: телефон без них — обіцянка, якої готель не давав, і гість,
    // що дзвонить о 02:40 у гудки, вважає, що готель не відповідає.
    // Порожні частини просто зникають, а не лишають « · · ».
    const line = [sheet.helpRole, sheet.hours, sheet.address].filter(Boolean).join(' · ');
    doc.font('body').fontSize(8.5).fillColor(MUTED)
      .text(line, left + mm(8), panelY + mm(19), { width: textW });
  }

  // Останній рядок — документ. Підвального рядка з адресою, хвостом ключа й
  // датою більше немає (рішення власника 19.09): адреса тепер у панелі
  // допомоги, де вона потрібна, а хвіст із датою були службовою позначкою
  // на видному місці. Ціна названа: відрізнити старий надрукований аркуш
  // від чинного тепер можна лише перевіривши код телефоном.
  doc.font('body').fontSize(8).fillColor(MUTED).text(sheet.idNote, left, idY, centre);

  doc.end();
  return done;
}
