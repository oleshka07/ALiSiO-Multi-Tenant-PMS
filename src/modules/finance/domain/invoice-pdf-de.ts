/**
 * The German invoice, drawn.
 *
 * A separate file from invoice-pdf.ts on purpose. That one is a Czech document
 * — `cs-CZ` formatting, Czech labels, an IČ/DIČ header — in 575 lines of
 * layout. Adding Germany by branching inside it would interleave two countries'
 * rules in a file where neither could then be read, and the Czech customer's
 * invoice is in production.
 *
 * Everything this file knows about the LAW comes from invoice-document.ts:
 * which fields are mandatory, what the labels say, how numbers and dates are
 * written. Here there are only millimetres.
 *
 * What §14 UStG requires and where it is printed:
 *
 *   seller name + address          header block, top left
 *   Steuernummer / USt-IdNr        under the seller
 *   buyer name + address           address block (omitted on a §33 invoice)
 *   invoice number, issue date     the meta block, right
 *   period of supply               the meta block, right
 *   quantity + description         the line table
 *   net per rate, rate, tax        MwSt-Übersicht
 *   gross                          the total row
 */
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import type { InvoiceDocument } from './invoice-document.ts';

/** DejaVu, because the default fonts have no ü, ö or ß. */
function font(name: 'regular' | 'bold'): string {
  const file = name === 'bold' ? 'DejaVuSans-Bold.ttf' : 'DejaVuSans.ttf';
  return path.join(process.cwd(), 'src', 'assets', 'fonts', file);
}

const PW = 595.28;   // A4 width in points
const ML = 48;
const MR = 48;
const CR = PW - MR;

export async function generateGermanInvoicePdf(doc: InvoiceDocument): Promise<Buffer> {
  const L = doc.labels;
  const isStorno = doc.status === 'storno';

  // QR codes are rendered BEFORE the drawing promise: qrcode's API is async,
  // and pdfkit's stream is not a place to await in.
  const qrImages = new Map<string, Buffer>();
  for (const f of doc.fiscal ?? []) {
    if (f.qrPayload && !qrImages.has(f.qrPayload)) {
      qrImages.set(f.qrPayload, await QRCode.toBuffer(f.qrPayload, { margin: 0, width: 140 }));
    }
  }

  return await new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: 48, bottom: 56, left: ML, right: MR },
      info: {
        Title: `${isStorno ? L.storno : L.invoice} ${doc.number}`,
        Author: doc.seller.name,
        Creator: 'ALiSiO ERP',
      },
    });

    const chunks: Buffer[] = [];
    pdf.on('data', (c) => chunks.push(c as Buffer));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    try {
      pdf.registerFont('r', font('regular'));
      pdf.registerFont('b', font('bold'));
    } catch { /* fall back to the built-ins; the text is still correct */ }

    const money = (n: number) => doc.formatMoney(n);
    const date = (s: string) => doc.formatDate(s);

    // ── seller ───────────────────────────────────────────────────────────────
    pdf.font('b').fontSize(14).text(doc.seller.name, ML, 48);
    pdf.font('r').fontSize(9);
    if (doc.seller.address) pdf.text(doc.seller.address, ML, pdf.y + 2, { width: 260 });
    if (doc.seller.taxNumber) pdf.text(`${L.taxNumber}: ${doc.seller.taxNumber}`, ML, pdf.y + 1);
    if (doc.seller.vatId) pdf.text(`${L.vatId}: ${doc.seller.vatId}`, ML, pdf.y + 1);

    // ── title and meta, right ────────────────────────────────────────────────
    pdf.font('b').fontSize(18)
      .text(isStorno ? L.storno : L.invoice, CR - 220, 48, { width: 220, align: 'right' });

    const meta: [string, string][] = [
      [L.number, doc.number],
      [L.issueDate, date(doc.issueDate)],
    ];
    if (doc.serviceFrom || doc.serviceTo) {
      meta.push([L.servicePeriod,
        [doc.serviceFrom && date(doc.serviceFrom), doc.serviceTo && date(doc.serviceTo)]
          .filter(Boolean).join(' – ')]);
    }
    if (isStorno && doc.correctsNumber) meta.push([L.reverses, doc.correctsNumber]);

    let my = 76;
    pdf.fontSize(9);
    for (const [k, v] of meta) {
      pdf.font('r').text(`${k}:`, CR - 220, my, { width: 110, align: 'right' });
      pdf.font('b').text(v, CR - 106, my, { width: 106, align: 'right' });
      my += 13;
    }

    // ── buyer ────────────────────────────────────────────────────────────────
    let y = Math.max(pdf.y, my) + 22;
    if (doc.buyer?.name) {
      pdf.font('r').fontSize(8).text(`${L.buyer}:`, ML, y);
      pdf.font('b').fontSize(10).text(doc.buyer.name, ML, y + 11);
      if (doc.buyer.address) pdf.font('r').fontSize(9).text(doc.buyer.address, ML, pdf.y + 1, { width: 260 });
      if (doc.buyer.vatId) pdf.font('r').fontSize(9).text(`${L.vatId}: ${doc.buyer.vatId}`, ML, pdf.y + 1);
      y = pdf.y + 18;
    } else if (doc.isSmallAmount) {
      pdf.font('r').fontSize(8).text(L.smallAmountNote, ML, y);
      y = pdf.y + 14;
    }

    // ── lines ────────────────────────────────────────────────────────────────
    // Columns Gastname and Zi-Nr are here because the reference invoice prints
    // them: on a folio covering several guests they are the only way to tell
    // whose breakfast a line is.
    const cols = [
      { key: 'pos', label: L.position, x: ML, w: 24, align: 'left' as const },
      { key: 'desc', label: L.description, x: ML + 26, w: 132, align: 'left' as const },
      { key: 'guest', label: L.guest, x: ML + 160, w: 84, align: 'left' as const },
      { key: 'room', label: L.room, x: ML + 246, w: 30, align: 'left' as const },
      { key: 'date', label: L.serviceDate, x: ML + 278, w: 56, align: 'left' as const },
      { key: 'qty', label: L.quantity, x: ML + 336, w: 30, align: 'right' as const },
      { key: 'rate', label: L.vatRate, x: ML + 368, w: 30, align: 'right' as const },
      { key: 'sum', label: L.lineTotal, x: ML + 400, w: 99, align: 'right' as const },
    ];

    pdf.font('b').fontSize(8);
    for (const c of cols) pdf.text(c.label, c.x, y, { width: c.w, align: c.align, lineBreak: false });
    y += 12;
    pdf.moveTo(ML, y).lineTo(CR, y).lineWidth(0.5).stroke();
    y += 6;

    pdf.font('r').fontSize(8.5);
    for (const l of doc.lines) {
      if (y > 690) { pdf.addPage(); y = 56; }
      const cells: Record<string, string> = {
        pos: String(l.position),
        desc: l.description,
        guest: l.guest_name || '',
        room: l.unit_code || '',
        date: l.service_date ? date(l.service_date) : '',
        qty: String(l.quantity),
        rate: `${l.vat_rate} %`,
        sum: money(l.total_gross),
      };
      const h = pdf.heightOfString(cells.desc, { width: cols[1].w }) + 4;
      for (const c of cols) {
        pdf.text(cells[c.key], c.x, y, { width: c.w, align: c.align, lineBreak: c.key === 'desc' });
      }
      y += Math.max(h, 13);
    }

    y += 2;
    pdf.moveTo(ML, y).lineTo(CR, y).stroke();
    y += 8;

    // ── total ────────────────────────────────────────────────────────────────
    pdf.font('b').fontSize(11);
    pdf.text(`${L.total}:`, CR - 260, y, { width: 160, align: 'right' });
    pdf.text(money(doc.gross), CR - 96, y, { width: 96, align: 'right' });
    y = pdf.y + 6;

    if ((doc.paid ?? 0) !== 0) {
      pdf.font('r').fontSize(9.5);
      pdf.text(`${L.paid}:`, CR - 260, y, { width: 160, align: 'right' });
      pdf.text(money(doc.paid ?? 0), CR - 96, y, { width: 96, align: 'right' });
      y = pdf.y + 3;
      pdf.font('b').fontSize(10);
      pdf.text(`${L.outstanding}:`, CR - 260, y, { width: 160, align: 'right' });
      pdf.text(money(doc.outstanding), CR - 96, y, { width: 96, align: 'right' });
      y = pdf.y + 6;
    }

    // ── MwSt-Übersicht ───────────────────────────────────────────────────────
    y += 14;
    pdf.font('b').fontSize(9).text(L.recap, ML, y);
    y += 13;

    const rc = [
      { label: L.vatRate, x: ML, w: 60, align: 'left' as const },
      { label: L.gross, x: ML + 62, w: 80, align: 'right' as const },
      { label: L.net, x: ML + 146, w: 80, align: 'right' as const },
      { label: L.tax, x: ML + 230, w: 80, align: 'right' as const },
    ];
    pdf.font('r').fontSize(8);
    for (const c of rc) pdf.text(c.label, c.x, y, { width: c.w, align: c.align, lineBreak: false });
    y += 11;
    pdf.moveTo(ML, y).lineTo(ML + 310, y).stroke();
    y += 5;

    pdf.fontSize(8.5);
    for (const t of doc.taxTotals) {
      const cells = [`${t.vat_rate} %`, money(t.gross_amount), money(t.net_amount), money(t.tax_amount)];
      rc.forEach((c, i) => pdf.text(cells[i], c.x, y, { width: c.w, align: c.align, lineBreak: false }));
      y += 12;
    }

    // ── TSE-Daten (§ 6 KassenSichV) ──────────────────────────────────────────
    // TEXT plus QR, and the text is not optional: the QR is DSFinV-K
    // machine convenience, the readable fields are what §6 lists. A failed
    // signature prints the outage wording — the beleg never pretends.
    for (const f of doc.fiscal ?? []) {
      const qr = f.qrPayload ? qrImages.get(f.qrPayload) : undefined;
      const blockH = f.failed ? 34 : 96;
      if (y + blockH > 740) { pdf.addPage(); y = 56; }
      y += 14;
      pdf.font('b').fontSize(8).text(L.fiscalTitle, ML, y);
      y += 11;
      if (f.failed) {
        pdf.font('r').fontSize(8).text(L.fiscalFailed, ML, y, { width: CR - ML - 90 });
        y = pdf.y + 4;
      } else {
        const rowsF: [string, string | null | undefined][] = [
          [L.fiscalRecordingSerial, f.recordingSystemSerial],
          [L.fiscalTseSerial, f.tseSerial],
          [L.fiscalTxNumber, f.txNumber],
          [L.fiscalSignatureCounter, f.signatureCounter],
          [L.fiscalStart, f.startTime],
          [L.fiscalEnd, f.endTime],
          [L.fiscalSignature, f.signature],
        ];
        pdf.fontSize(7);
        const qrX = CR - 78;
        const blockTop = y;
        for (const [k, v] of rowsF) {
          if (!v) continue;
          pdf.font('r').text(`${k}:`, ML, y, { width: 150, lineBreak: false });
          // The Prüfwert is long base64 — wrapped, never truncated: a
          // shortened signature verifies nothing.
          pdf.font('b').text(String(v), ML + 154, y, { width: qrX - ML - 162 });
          y = Math.max(pdf.y, y + 9);
        }
        if (qr) {
          pdf.image(qr, qrX, blockTop, { width: 70, height: 70 });
          y = Math.max(y, blockTop + 74);
        }
        y += 4;
      }
    }

    // ── payment details and footer ───────────────────────────────────────────
    if (doc.seller.iban) {
      y += 14;
      pdf.font('r').fontSize(8.5)
        .text([doc.seller.bankName, `IBAN: ${doc.seller.iban}`].filter(Boolean).join(' · '), ML, y, { width: CR - ML });
    }

    pdf.font('r').fontSize(7.5)
      .text([doc.seller.name, doc.seller.email, doc.seller.phone].filter(Boolean).join(' · '),
        ML, 800, { width: CR - ML, align: 'center', lineBreak: false });

    pdf.end();
  });
}
