/**
 * Local OCR worker. Reads an image (path or data URL) on stdin, prints
 * {success, text} as JSON on stdout.
 *
 * Run in a child process so a Tesseract crash or hang cannot take the request
 * down with it, and because tesseract.js pulls in WASM that has no business
 * loading inside the Next.js server bundle.
 *
 * langPath points at the language data shipped in the repository: the default
 * would fetch it from a CDN on first use, which means a passport scan waits on
 * a network round trip, and an offline or firewalled server silently falls back
 * to sending the image to a third party instead.
 */
const path = require('path');
const Tesseract = require('tesseract.js');

const LANG_PATH = path.join(process.cwd(), 'ocr-lang');
const TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 25000);

// tesseract.js surfaces worker failures — a truncated upload, a file that is
// not really an image — as an asynchronous event, which a try/catch around
// recognize() never sees. Without this the process dies with a stack trace and
// the caller has to infer what happened from a non-zero exit code.
function fail(message) {
  console.log(JSON.stringify({ success: false, error: String(message) }));
  process.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;

  const image = input.trim();
  if (!image) {
    console.log(JSON.stringify({ success: false, error: 'No image provided via stdin' }));
    process.exit(1);
  }

  const timer = setTimeout(() => {
    console.log(JSON.stringify({ success: false, error: `Timed out after ${TIMEOUT_MS}ms` }));
    process.exit(1);
  }, TIMEOUT_MS);

  try {
    const result = await Tesseract.recognize(image, 'eng', {
      langPath: LANG_PATH,
      cachePath: LANG_PATH,
      logger: () => {},
    });
    clearTimeout(timer);
    console.log(JSON.stringify({ success: true, text: result.data.text }));
    process.exit(0);
  } catch (error) {
    clearTimeout(timer);
    console.log(JSON.stringify({ success: false, error: error.message }));
    process.exit(1);
  }
}

main();
