/**
 * Walk the whole application the way a person would, and write down what is
 * broken: console errors, failed requests, pages that crash, and buttons that
 * do nothing when clicked.
 *
 *   npm run build:win && npm start &
 *   AUDIT_EMAIL=owner@test AUDIT_PASSWORD=... node scripts/audit-ui.mjs
 *
 * Why this exists: tsc, the gates and the .check.ts files prove properties of
 * the code; none of them clicks a button. A dead button — an onClick that was
 * never wired, a handler whose fetch 404s, a modal that renders behind its
 * overlay — compiles cleanly, passes every audit and fails only in a hand.
 * This script is that hand, run by a machine: BFS over every in-app link,
 * then every visible button on every page, recording what reacted and what
 * did not.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 * It logs in and clicks. In its default mode it does NOT press submit buttons
 * and skips anything whose label smells destructive (delete, cancel, pay,
 * send…), and every native confirm() is answered with Cancel. That still
 * leaves plenty of ways to mutate state — RUN IT AGAINST A DISPOSABLE
 * DATABASE ONLY, the same rule as smoke-writes.mjs. A fresh tenant comes from
 * scripts/provision-org.mjs.
 *
 * ── Env ─────────────────────────────────────────────────────────────────────
 *   BASE_URL          default http://127.0.0.1:3000
 *   AUDIT_EMAIL       operator login; with AUDIT_PASSWORD, required
 *   AUDIT_PASSWORD    operator password
 *   AUDIT_PUBLIC=1    skip login, crawl only what an anonymous visitor sees
 *   AUDIT_CLICK       safe (default) | off | all   — all also presses submits
 *   AUDIT_MAX_PAGES   default 150
 *   AUDIT_MAX_DEPTH   default 6
 *   AUDIT_REPORT      default audit-ui-report.json (gitignored)
 *
 * Reading the output: DEAD_BUTTON means the click changed nothing the script
 * can observe — no DOM mutation, no navigation, no network, no dialog within
 * 800ms. A button that only starts something slower than that can be a false
 * positive; the list is a worksheet, not a verdict. HTTP_4xx/5xx and
 * PAGE_CRASH entries are real regardless.
 */
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const EMAIL = process.env.AUDIT_EMAIL || '';
const PASSWORD = process.env.AUDIT_PASSWORD || '';
const PUBLIC_ONLY = process.env.AUDIT_PUBLIC === '1';
const CLICK_MODE = process.env.AUDIT_CLICK || 'safe';
const MAX_PAGES = Number(process.env.AUDIT_MAX_PAGES || 150);
const MAX_DEPTH = Number(process.env.AUDIT_MAX_DEPTH || 6);
const REPORT = process.env.AUDIT_REPORT || 'audit-ui-report.json';

// Buttons never pressed in safe mode. Ukrainian first — that is what the
// operator UI renders — with the English the code sometimes uses.
const DESTRUCTIVE =
  /видал|стерт|очист|скасув|відмін|вийти|вихід|оплат|сплат|надісл|відправ|delete|remove|clear|cancel|logout|sign ?out|pay|charge|send|submit/i;

if (!PUBLIC_ONLY && (!EMAIL || !PASSWORD)) {
  console.error('AUDIT_EMAIL and AUDIT_PASSWORD are required (or AUDIT_PUBLIC=1).');
  console.error('Create a disposable tenant first: node scripts/provision-org.mjs --help');
  process.exit(2);
}

const findings = [];
const seenFinding = new Set();
function report(type, data) {
  const key = type + '|' + JSON.stringify(data);
  if (seenFinding.has(key)) return;
  seenFinding.add(key);
  findings.push({ type, ...data });
}

// /app/bookings/3f2a… and /app/bookings/9c1b… are the same screen. Visit a
// couple of representatives per pattern, not every row of the database.
function patternOf(pathname) {
  return pathname.replace(/\/(\d+|[0-9a-f-]{8,})(?=\/|$)/gi, '/:id');
}

const visited = new Set();
const perPattern = new Map();
const queue = [];
function enqueue(pathname, depth) {
  if (depth > MAX_DEPTH) return;
  if (visited.has(pathname)) return;
  const pat = patternOf(pathname);
  if ((perPattern.get(pat) || 0) >= 2) return;
  visited.add(pathname);
  perPattern.set(pat, (perPattern.get(pat) || 0) + 1);
  queue.push({ pathname, depth });
}

// AUDIT_CHROMIUM: a browser binary to use when the Playwright-managed one is
// not installed (CI images, containers with a system Chromium).
const browser = await chromium.launch(
  process.env.AUDIT_CHROMIUM ? { executablePath: process.env.AUDIT_CHROMIUM } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// A popup a button opens is not part of this crawl; close it so the click
// still registers as "did something" via the dialog/network counters.
ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });

let currentUrl = () => { try { return page.url(); } catch { return '?'; } };
let requestCount = 0;
let dialogCount = 0;

page.on('request', () => { requestCount++; });
page.on('console', (m) => {
  if (m.type() === 'error') report('CONSOLE_ERROR', { page: currentUrl(), msg: m.text().slice(0, 300) });
});
page.on('pageerror', (e) => report('PAGE_CRASH', { page: currentUrl(), msg: String(e.message).slice(0, 300) }));
page.on('response', (r) => {
  const s = r.status();
  if (s >= 400) report(s >= 500 ? 'HTTP_5XX' : 'HTTP_4XX', { page: currentUrl(), status: s, req: r.url().slice(0, 200) });
});
page.on('requestfailed', (r) => {
  const why = r.failure()?.errorText || '';
  if (why.includes('ERR_ABORTED')) return; // navigations abort in-flight requests; not a bug
  report('REQUEST_FAILED', { page: currentUrl(), req: r.url().slice(0, 200), why });
});
// Cancel is the only safe answer a machine can give a confirm().
page.on('dialog', (d) => { dialogCount++; d.dismiss().catch(() => {}); });

async function login() {
  await page.goto(`${BASE}/app/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForURL('**/app/dashboard**', { timeout: 20_000 }),
    page.click('.login-form button[type=submit], .login-form button'),
  ]).catch(async () => {
    const err = await page.locator('.login-error').textContent().catch(() => null);
    console.error(`Login failed${err ? `: ${err.trim()}` : ''} — check AUDIT_EMAIL/AUDIT_PASSWORD against ${BASE}`);
    await browser.close();
    process.exit(2);
  });
}

async function collectLinks(depth) {
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('href')))
    .catch(() => []);
  for (const href of new Set(hrefs)) {
    if (!href) continue;
    if (href === '#' || href.startsWith('#')) {
      report('ANCHOR_HASH', { page: currentUrl(), href });
      continue;
    }
    let u;
    try { u = new URL(href, BASE); } catch { continue; }
    if (u.origin !== new URL(BASE).origin) continue;
    if (u.pathname.startsWith('/api/')) continue;
    if (/logout|signout/.test(u.pathname)) continue;
    if (!PUBLIC_ONLY && !u.pathname.startsWith('/app')) continue; // stay in the operator app
    enqueue(u.pathname, depth + 1);
  }
}

async function clickButtons(pageUrl) {
  if (CLICK_MODE === 'off') return;
  const started = Date.now();
  const buttons = page.locator('button:visible, [role=button]:visible');
  const count = Math.min(await buttons.count().catch(() => 0), 40);

  for (let i = 0; i < count; i++) {
    if (Date.now() - started > 30_000) break; // one page must not eat the run

    const btn = buttons.nth(i);
    const label = ((await btn.textContent().catch(() => '')) ||
      (await btn.getAttribute('aria-label').catch(() => '')) || '')
      .replace(/\s+/g, ' ').trim().slice(0, 60);

    if (CLICK_MODE !== 'all') {
      if (DESTRUCTIVE.test(label)) continue;
      const type = await btn.getAttribute('type').catch(() => null);
      if (type === 'submit') continue;
    }
    // A button with no text and no aria-label cannot be announced by a screen
    // reader — and in this codebase it usually means the button is unfinished.
    if (!label) {
      const hasIcon = await btn.locator('svg, img').count().catch(() => 0);
      report('BUTTON_NO_NAME', { page: pageUrl, icon: hasIcon > 0 });
    }

    // What counts as "the click did something": DOM mutated, URL changed,
    // a request left, a dialog appeared. Snapshot all four, click, compare.
    await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      if (!w.__auditMut) {
        w.__auditMut = { n: 0 };
        new MutationObserver((m) => { w.__auditMut.n += m.length; })
          .observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      }
    }).catch(() => {});

    const before = {
      mut: await page.evaluate(() => /** @type {any} */ (window).__auditMut?.n ?? 0).catch(() => 0),
      url: page.url(),
      req: requestCount,
      dlg: dialogCount,
    };

    const clicked = await btn.click({ timeout: 1500, noWaitAfter: true }).then(() => true).catch(() => false);
    if (!clicked) continue; // covered by an overlay or detached — not this script's finding
    await page.waitForTimeout(800);

    const after = {
      mut: await page.evaluate(() => /** @type {any} */ (window).__auditMut?.n ?? 0).catch(() => 0),
      url: page.url(),
      req: requestCount,
      dlg: dialogCount,
    };

    if (after.mut === before.mut && after.url === before.url && after.req === before.req && after.dlg === before.dlg) {
      report('DEAD_BUTTON', { page: pageUrl, label: label || '(no label)' });
    }

    if (after.url !== before.url) {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(300);
    } else if (after.dlg !== before.dlg || after.mut > before.mut + 50) {
      // A modal probably opened; Escape closes it so the next button is the
      // page's, not the modal's.
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
    }
  }
}

// ── Crawl ────────────────────────────────────────────────────────────────────
if (!PUBLIC_ONLY) await login();
enqueue(PUBLIC_ONLY ? '/' : '/app/dashboard', 0);

let done = 0;
while (queue.length && done < MAX_PAGES) {
  const { pathname, depth } = queue.shift();
  const url = BASE + pathname;
  const ok = await page
    .goto(url, { waitUntil: 'networkidle', timeout: 20_000 })
    .then(() => true)
    .catch((e) => { report('PAGE_UNREACHABLE', { page: url, why: String(e.message).slice(0, 120) }); return false; });
  if (!ok) continue;
  done++;
  process.stderr.write(`\r${done}/${MAX_PAGES} pages, queue ${queue.length}, findings ${findings.length}   `);
  await collectLinks(depth);
  await clickButtons(url);
}
process.stderr.write('\n');

await browser.close();

// ── Report ───────────────────────────────────────────────────────────────────
const order = ['PAGE_CRASH', 'HTTP_5XX', 'DEAD_BUTTON', 'HTTP_4XX', 'CONSOLE_ERROR', 'REQUEST_FAILED', 'PAGE_UNREACHABLE', 'BUTTON_NO_NAME', 'ANCHOR_HASH'];
findings.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

const counts = {};
for (const f of findings) counts[f.type] = (counts[f.type] || 0) + 1;

console.log(`\nCrawled ${done} pages (${visited.size} discovered) on ${BASE}\n`);
console.table(counts);
for (const type of order) {
  const of = findings.filter((f) => f.type === type);
  if (!of.length) continue;
  console.log(`\n── ${type} (${of.length}) ${'─'.repeat(Math.max(0, 50 - type.length))}`);
  for (const f of of.slice(0, 15)) {
    const { type: _t, page: p, ...rest } = f;
    console.log(`  ${p}\n    ${Object.entries(rest).map(([k, v]) => `${k}=${String(v).slice(0, 140)}`).join('  ')}`);
  }
  if (of.length > 15) console.log(`  … ${of.length - 15} more in ${REPORT}`);
}

fs.writeFileSync(REPORT, JSON.stringify({ base: BASE, crawled: done, when: new Date().toISOString(), findings }, null, 2));
console.log(`\nFull report: ${REPORT}`);
