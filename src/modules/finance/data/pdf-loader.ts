/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

/**
 * Lazy access to pdf-parse.
 *
 * Importing it at module scope put a bank-statement PDF parser into the server
 * boot chain: instrumentation → modules → kb-pdf-parser → pdf-parse. In the
 * standalone production build Turbopack loads externals through require(),
 * which takes pdf-parse's CommonJS path and throws
 * "ReferenceError: DOMMatrix is not defined" — so the container crash-looped on
 * startup while dev, which resolves externals only on first use, looked fine.
 *
 * Loading it through dynamic import() at the point of use fixes both: the
 * server starts without it, and when a PDF does arrive the ESM entry is used,
 * which does not touch DOMMatrix.
 */

let cached: any = null;
let workerReady = false;

export async function loadPdfParse(): Promise<any> {
  if (!cached) {
    const mod: any = await import('pdf-parse');
    cached = mod.PDFParse ?? mod.default?.PDFParse ?? mod.default;
  }
  ensureWorker(cached);
  return cached;
}

/**
 * pdfjs-dist v5+ lazy-loads its worker with ESM import(), which needs a file://
 * URL rather than a bare path — otherwise Windows dev fails on "protocol 'd:'"
 * and Linux fails on "Cannot find module".
 */
function ensureWorker(PDFParse: any): void {
  if (workerReady || !PDFParse?.setWorker) return;
  try {
    const requireFn = createRequire(import.meta.url);
    const workerPath = requireFn.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    PDFParse.setWorker(pathToFileURL(workerPath).href);
    workerReady = true;
  } catch (e: any) {
    // Not fatal: pdfjs falls back to running in-process, only slower.
    console.log('[pdf-loader] worker not resolved:', e.message);
  }
}
