/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface XlsxColumn {
  header: string;
  key: string;
  width?: number;
  numFmt?: string;
  align?: 'left' | 'right' | 'center';
}

export interface XlsxSheet {
  name: string;
  columns: XlsxColumn[];
  rows: Record<string, any>[];
  totalsRow?: Record<string, any>;
  freezeHeader?: boolean;
}

const HEADER_FILL = 'FFEFF1F5';
const TOTALS_FILL = 'FFE0E7FF';
const NEG_COLOR = 'FFDC2626';
const POS_COLOR = 'FF16A34A';

export async function buildXlsx(sheets: XlsxSheet[], meta?: { title?: string; subtitle?: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALiSiO PMS';
  wb.created = new Date();

  for (const def of sheets) {
    const ws = wb.addWorksheet(def.name.substring(0, 31));
    let firstDataRow = 1;

    if (meta?.title || meta?.subtitle) {
      if (meta.title) {
        const r = ws.addRow([meta.title]);
        r.font = { bold: true, size: 14 };
        ws.mergeCells(r.number, 1, r.number, def.columns.length);
        firstDataRow++;
      }
      if (meta.subtitle) {
        const r = ws.addRow([meta.subtitle]);
        r.font = { size: 10, color: { argb: 'FF6B7280' } };
        ws.mergeCells(r.number, 1, r.number, def.columns.length);
        firstDataRow++;
      }
      ws.addRow([]);
      firstDataRow++;
    }

    ws.columns = def.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width || 16,
      style: {
        numFmt: c.numFmt,
        alignment: c.align ? { horizontal: c.align } : undefined,
      },
    })) as any;

    if (firstDataRow > 1) {
      const headerRow = ws.getRow(firstDataRow);
      def.columns.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
      headerRow.commit();
    }
    const headerRow = ws.getRow(firstDataRow);
    headerRow.font = { bold: true, color: { argb: 'FF1F2937' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    headerRow.alignment = { vertical: 'middle' };
    headerRow.height = 22;

    for (const row of def.rows) {
      const r = ws.addRow(row);
      for (const c of def.columns) {
        const cell = r.getCell(c.key);
        if (c.numFmt && typeof cell.value === 'number') {
          if (cell.value < 0) cell.font = { color: { argb: NEG_COLOR } };
          else if (cell.value > 0 && c.key.toLowerCase().includes('income')) cell.font = { color: { argb: POS_COLOR } };
        }
      }
    }

    if (def.totalsRow) {
      const r = ws.addRow(def.totalsRow);
      r.font = { bold: true };
      r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_FILL } };
    }

    if (def.freezeHeader !== false) {
      ws.views = [{ state: 'frozen', ySplit: firstDataRow, xSplit: 0 }];
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export interface PdfTable {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  colWidths?: number[];
  totalsRow?: (string | number)[];
}

export function buildPdf(tables: PdfTable[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    tables.forEach((t, idx) => {
      if (idx > 0) doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').text(t.title, { align: 'left' });
      if (t.subtitle) {
        doc.fontSize(9).font('Helvetica').fillColor('#6B7280').text(t.subtitle);
        doc.fillColor('#000');
      }
      doc.moveDown(0.6);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const widths = t.colWidths && t.colWidths.length === t.headers.length
        ? t.colWidths
        : t.headers.map(() => pageWidth / t.headers.length);
      const startY = doc.y;
      let y = startY;

      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1F2937');
      doc.rect(doc.page.margins.left, y - 2, pageWidth, 18).fill('#EFF1F5').fillColor('#1F2937');
      let x = doc.page.margins.left;
      t.headers.forEach((h, i) => {
        doc.text(h, x + 4, y + 2, { width: widths[i] - 8, ellipsis: true });
        x += widths[i];
      });
      y += 18;

      doc.font('Helvetica').fontSize(8).fillColor('#000');
      for (const row of t.rows) {
        if (y + 18 > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        x = doc.page.margins.left;
        row.forEach((cell, i) => {
          const text = cell === null || cell === undefined ? '' : String(cell);
          const isNum = typeof cell === 'number';
          if (isNum && cell < 0) doc.fillColor('#DC2626');
          else doc.fillColor('#000');
          doc.text(text, x + 4, y + 2, {
            width: widths[i] - 8,
            ellipsis: true,
            align: isNum ? 'right' : 'left',
          });
          x += widths[i];
        });
        doc.fillColor('#000');
        y += 18;
      }

      if (t.totalsRow) {
        if (y + 18 > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = doc.page.margins.top; }
        doc.font('Helvetica-Bold').fontSize(9);
        doc.rect(doc.page.margins.left, y - 2, pageWidth, 18).fill('#E0E7FF').fillColor('#1F2937');
        x = doc.page.margins.left;
        t.totalsRow.forEach((cell, i) => {
          const text = cell === null || cell === undefined ? '' : String(cell);
          const isNum = typeof cell === 'number';
          doc.text(text, x + 4, y + 2, { width: widths[i] - 8, ellipsis: true, align: isNum ? 'right' : 'left' });
          x += widths[i];
        });
        doc.fillColor('#000');
      }
    });

    doc.end();
  });
}

export function exportFilename(slug: string, ext: 'xlsx' | 'pdf', range?: string): string {
  const date = new Date().toISOString().substring(0, 10);
  const range_ = range ? `_${range}` : '';
  return `${slug}${range_}_${date}.${ext}`;
}

export function attachmentResponse(buffer: Buffer, filename: string, ext: 'xlsx' | 'pdf'): Response {
  const contentType = ext === 'xlsx'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'application/pdf';
  // Use Uint8Array so Response handles it as binary in Node 20+
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  });
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '';
  return n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
