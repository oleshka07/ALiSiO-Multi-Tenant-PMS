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
 *     Це СТЕЛЯ, не константа — див. «висоти вимірюються» нижче;
 *   `margin: 4` — тиха зона. У `invoice-pdf-de.ts` стоїть `margin: 0`, бо
 *     там код у власній рамці; скопійований сюди, він забирає в частини
 *     читачів здатність побачити код узагалі;
 *   `errorCorrectionLevel: 'M'` — H потрібен лише під накладене лого. Лого
 *     всередині коду ми не ставимо, а M дає рідшу сітку, яку гірша камера
 *     бере впевненіше;
 *   ЧОРНИЙ НА БІЛОМУ завжди, навіть коли в готелю є палітра (0419). Читачу
 *     потрібен контраст; бірюзовий код на піщаному тлі проходить у салоні й
 *     не проходить у холі надвечір. Бренд живе в шапці, не в коді.
 *
 * ── Чому висоти ВИМІРЮЮТЬСЯ, а не задані ───────────────────────────────
 *
 * Перша редакція підвалу мала сталу висоту 26 мм. Готель Ґрайца вписав у
 * години два речення — робочі дні, вихідні, і окремо про ключовий автомат
 * уночі, — і рядок виліз із сірої плашки на білий папір трьома рядками.
 * Нічого не впало: PDF зібрався, сторінка лишилась одна, просто виглядало
 * зламано.
 *
 * Клас, а не випадок: висота тексту залежить від ДАНИХ ГОТЕЛЮ, яких ми не
 * бачили. Тому розрахунок винесено в `planSheet` — названу функцію, яку
 * гейт міряє тими самими метриками шрифта, що й малювання, і тому не може
 * з ним розійтися. Код дістає те, що лишилось, і зменшується в межах
 * [`QR_MIN_MM`, `QR_SIDE_MM`]; кегль підвалу ступає вниз по `META_SIZES`;
 * не вміщається й найменшим — `fits: false`, і `renderSheetPdf` КИДАЄ.
 *
 * Відмова тут дешевша за папір: аркуш із заїханим текстом однаково
 * передруковувати, і дізнатись про це краще відмовою, ніж після друку.
 */
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { SheetContent } from './a4-sheet.ts';

/** Міліметри в точки PDF. */
export const mm = (v: number) => (v * 72) / 25.4;

/** Стеля коду. Більше не буває, менше — коли підвал просить місця. */
const QR_SIDE_MM = 105;
/**
 * Підлога коду. Нижче не опускаємось навіть заради тексту: 70 мм читаються
 * приблизно з 70 см, і це вже межа, за якою гість мусить підійти впритул.
 * Не вміщається з цією підлогою — відмова, а не ще менший код.
 */
export const QR_MIN_MM = 70;
const MARGIN_MM = 18;
/** Кеглі підвалу від бажаного до крайнього. Далі — відмова. */
const META_SIZES = [8.5, 8, 7.5, 7, 6.5, 6] as const;

/** Сірі тони. Один набір на весь аркуш — щоб «трохи інший сірий» не завівся. */
const INK = '#1a1a1a';
const MUTED = '#6b6b6b';
const HAIRLINE = '#d8d8d8';
const PANEL = '#f4f4f2';

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

/** Рівно те з документа, що потрібне для вимірювання. */
type Measurer = Pick<PDFKit.PDFDocument, 'font' | 'fontSize' | 'heightOfString' | 'page'>;

/** Що вийшло порахувати. Малювання бере числа ЛИШЕ звідси. */
export interface SheetPlan {
  /** `false` — текст не вміщається навіть найдрібнішим кеглем. */
  fits: boolean;
  /** Сторона коду. У межах [QR_MIN, QR_SIDE], коли `fits`. */
  qrSide: number;
  /** Висота сірої плашки. Нуль — плашки немає. */
  panelH: number;
  /** Висота тексту ВСЕРЕДИНІ плашки, без полів. Плашка не буває меншою. */
  panelTextH: number;
  /** Обраний кегль рядка під номером. */
  metaSize: number;
  /** Сам рядок: хто, роль, години, адреса — без порожніх частин. */
  metaLine: string;
  /** Висота найвищої мовної колонки. */
  colH: number;
  /** Верх рядка «підготуйте документ». */
  idY: number;
  /** Відступ усередині плашки. */
  pad: number;
  /** Ширина тексту в плашці (код чату забирає своє). */
  textW: number;
  /** Сторона коду чату; нуль — коду немає. */
  chatSide: number;
  /** Чи малюємо плашку взагалі. */
  hasPanel: boolean;
  /** Низ усього намальованого. Має лишатись у межах сторінки. */
  contentBottom: number;
}

/**
 * Порахувати геометрію аркуша, НІЧОГО не малюючи.
 *
 * Винесено окремо, щоб властивість «текст вміщається у відведене місце»
 * можна було СТВЕРДЖУВАТИ, а не оглядати очима. Перша редакція мала сталу
 * плашку, і жоден гейт не бачив, як текст із неї вилазить: сторінка
 * лишалась одна, PDF збирався, просто виглядало зламано.
 */
export function planSheet(
  doc: Measurer, sheet: SheetContent, headerBottom: number, hasChatQr: boolean,
): SheetPlan {
  const width = doc.page.width - mm(MARGIN_MM) * 2;

  // ── Колонки мов ────────────────────────────────────────────────────────
  const cols = sheet.blocks.length;
  const gap = mm(8);
  const colWidth = (width - gap * (cols - 1)) / cols;
  let colH = 0;
  for (const block of sheet.blocks) {
    let h = doc.font('bold').fontSize(9).heightOfString(block.langName.toUpperCase(),
      { width: colWidth, characterSpacing: 1.5 });
    h += mm(4);
    h += doc.font('bold').fontSize(10.5).heightOfString(block.lead, { width: colWidth });
    h += mm(2.5);
    for (const bullet of block.bullets) {
      h += doc.font('body').fontSize(9.5)
        .heightOfString(`${bullet.label} ${bullet.text}`, { width: colWidth - mm(4.5) });
      h += mm(2);
    }
    h += mm(1) + doc.font('body').fontSize(8.5).heightOfString(block.tail, { width: colWidth });
    colH = Math.max(colH, h);
  }

  // ── Підвал ─────────────────────────────────────────────────────────────
  const idH = doc.font('body').fontSize(8).heightOfString(sheet.idNote, { width });
  const idY = doc.page.height - mm(MARGIN_MM) - idH;

  // Рядок під номером. Порожні частини зникають, а не лишають « · · ».
  const metaLine = [sheet.helpName, sheet.helpRole, sheet.hours, sheet.address]
    .filter(Boolean).join(' · ');

  const chatSide = hasChatQr ? mm(20) : 0;
  const pad = mm(7);
  const hasPanel = Boolean(sheet.phone || hasChatQr);
  const textW = width - pad * 2 - (hasChatQr ? chatSide + mm(5) : 0);

  const textHeightAt = (metaSize: number): number => {
    const labelH = doc.font('body').fontSize(8.5).heightOfString(sheet.helpLabel, { width: textW });
    const phoneH = doc.font('bold').fontSize(19).heightOfString(sheet.phone || ' ', { width: textW });
    const metaH = metaLine
      ? doc.font('body').fontSize(metaSize).heightOfString(metaLine, { width: textW })
      : 0;
    return labelH + mm(1) + phoneH + mm(1.5) + metaH;
  };
  const panelHeightAt = (metaSize: number): number => {
    if (!hasPanel) return 0;
    // Код чату має власну висоту з підписом: плашка не буває нижчою за нього.
    const chatH = hasChatQr ? chatSide + mm(5) : 0;
    return Math.max(textHeightAt(metaSize), chatH) + pad * 2;
  };

  /** Скільки лишається коду при такому підвалі. */
  const qrRoom = (panelH: number): number =>
    (hasPanel ? idY - mm(6) - panelH : idY) - mm(6) - colH - headerBottom - mm(9);

  const shape = (metaSize: number, fits: boolean, qrSide: number): SheetPlan => ({
    fits,
    qrSide,
    panelH: panelHeightAt(metaSize),
    panelTextH: hasPanel ? textHeightAt(metaSize) : 0,
    metaSize,
    metaLine,
    colH,
    idY,
    pad,
    textW,
    chatSide,
    hasPanel,
    contentBottom: idY + idH,
  });

  for (const metaSize of META_SIZES) {
    const room = qrRoom(panelHeightAt(metaSize));
    if (room >= mm(QR_MIN_MM)) return shape(metaSize, true, Math.min(mm(QR_SIDE_MM), room));
  }

  const last = META_SIZES[META_SIZES.length - 1];
  return shape(last, false, Math.max(0, qrRoom(panelHeightAt(last))));
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
  const headerBottom = y + mm(7);

  // ── Усе міряється ДО малювання ─────────────────────────────────────────
  const plan = planSheet(doc, sheet, headerBottom, Boolean(chatQr));
  if (!plan.fits) {
    throw new Error(
      `A4 sheet does not fit: the code needs ${QR_MIN_MM}mm, `
      + `${(plan.qrSide / mm(1)).toFixed(0)}mm left after the footer. `
      + 'Shorten the reception hours, the name or the address.');
  }

  // Нижнє поле знімається ПЕРЕД підвалом, і це не косметика: pdfkit розриває
  // сторінку сам, щойно текст не вміщається в поле, а підвал ставиться в
  // саме поле навмисно. Перша версія дала рівно це — рядок «підготуйте
  // документ» поїхав на ДРУГУ сторінку. Межу тепер тримає `plan.fits`.
  doc.page.margins.bottom = 0;

  // ── QR ─────────────────────────────────────────────────────────────────
  y = headerBottom;
  const qrX = left + (width - plan.qrSide) / 2;
  const framePad = mm(5);
  doc.roundedRect(qrX - framePad, y - framePad,
    plan.qrSide + framePad * 2, plan.qrSide + framePad * 2, mm(3))
    .lineWidth(1).strokeColor(HAIRLINE).stroke();
  doc.image(qr, qrX, y, { width: plan.qrSide, height: plan.qrSide });
  y += plan.qrSide + framePad + mm(9);

  // Адреси текстом під кодом НЕМАЄ (рішення власника 19.09): ключ обʼєкта —
  // 16 випадкових символів, набрати його руками однаково ніхто не зможе,
  // тож рядок був не запасним шляхом, а шумом на видному місці.

  // ── Колонки мов ────────────────────────────────────────────────────────
  //
  // Мови стоять ПОРУЧ, кожна під своїм підписом. Рядками одна під одною
  // друга мова читалась як примітка до першої, і власник її не побачив.
  const cols = sheet.blocks.length;
  const gap = mm(8);
  const colWidth = (width - gap * (cols - 1)) / cols;
  const colTop = y;
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
      // Крапка малюється окремо: `•` у рядку зʼїхав би разом із переносом,
      // а так текст має рівний лівий край під будь-яку довжину мітки.
      doc.circle(x + mm(1.4), cy + mm(1.7), mm(0.9)).fillColor(INK).fill();
      const tx = x + mm(4.5);
      const tw = colWidth - mm(4.5);
      doc.font('bold').fontSize(9.5).fillColor(INK)
        .text(bullet.label, tx, cy, { width: tw, continued: true })
        .font('body').fillColor(INK).text(` ${bullet.text}`, { width: tw });
      cy = doc.y + mm(2);
    }

    doc.font('body').fontSize(8.5).fillColor(MUTED)
      .text(block.tail, x, cy + mm(1), { width: colWidth });
  });

  // ── Панель допомоги ────────────────────────────────────────────────────
  const panelY = plan.idY - mm(6) - plan.panelH;
  if (plan.hasPanel) {
    doc.roundedRect(left, panelY, width, plan.panelH, mm(3)).fillColor(PANEL).fill();

    const chatX = left + width - plan.pad - plan.chatSide;
    if (chatQr) {
      doc.image(chatQr, chatX, panelY + plan.pad,
        { width: plan.chatSide, height: plan.chatSide });
      doc.font('body').fontSize(6.5).fillColor(MUTED)
        .text('WhatsApp', chatX, panelY + plan.pad + plan.chatSide + mm(1),
          { width: plan.chatSide, align: 'center' });
    }

    let py = panelY + plan.pad;
    doc.font('body').fontSize(8.5).fillColor(MUTED)
      .text(sheet.helpLabel, left + plan.pad, py, { width: plan.textW });
    py = doc.y + mm(1);
    doc.font('bold').fontSize(19).fillColor(INK)
      .text(sheet.phone || ' ', left + plan.pad, py, { width: plan.textW });
    py = doc.y + mm(1.5);
    if (plan.metaLine) {
      doc.font('body').fontSize(plan.metaSize).fillColor(MUTED)
        .text(plan.metaLine, left + plan.pad, py, { width: plan.textW });
    }
  }

  // Останній рядок — документ.
  doc.font('body').fontSize(8).fillColor(MUTED).text(sheet.idNote, left, plan.idY, centre);

  doc.end();
  return done;
}
