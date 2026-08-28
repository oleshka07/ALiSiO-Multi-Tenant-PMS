import { getSql } from '@core/db/async';
/**
 * ALiSiO ERP — ČNB (Czech National Bank) daily FX rates.
 *
 * Pulls the official ČNB daily fixing feed and upserts <CUR>→CZK rates into
 * finance_exchange_rates, so invoices can convert EUR/USD/… to CZK without
 * manual entry.
 *
 * Feed (plain text, one fixing per business day):
 *   https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/daily.txt
 *   07 May 2026 #89
 *   Country|Currency|Amount|Code|Rate
 *   EMU|euro|1|EUR|25.290
 *   ...
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireOrganizationId, runWithOrganization } from '@core/auth/tenant-context';

const CNB_DAILY_URL =
  'https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/daily.txt';

/** Currencies we keep quoted against CZK. EUR is the one invoices actually need. */
export const DEFAULT_CNB_CURRENCIES = ['EUR', 'USD', 'GBP', 'PLN'];

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

export interface CnbFixing {
  date: string;                     // YYYY-MM-DD (fixing date)
  rates: Record<string, number>;    // { EUR: 25.29, USD: 23.10, ... } — CZK per 1 unit
}

async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'ALiSiO-ERP' } });
    if (!res.ok) throw new Error(`ČNB feed HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Parse the ČNB daily.txt body into a fixing (date + CUR→CZK rates). */
export function parseCnbDaily(body: string): CnbFixing {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Empty ČNB feed');

  // Header: "07 May 2026 #89"
  const m = lines[0].match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) throw new Error(`Unexpected ČNB header: ${lines[0].slice(0, 40)}`);
  const day = m[1].padStart(2, '0');
  const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!mon) throw new Error(`Unknown month in ČNB header: ${m[2]}`);
  const date = `${m[3]}-${mon}-${day}`;

  const rates: Record<string, number> = {};
  for (const line of lines.slice(1)) {
    // Country|Currency|Amount|Code|Rate
    const parts = line.split('|');
    if (parts.length < 5) continue;
    const amount = Number(parts[2]);
    const code = parts[3].trim().toUpperCase();
    const rate = Number(parts[4].replace(',', '.'));
    if (!/^[A-Z]{3}$/.test(code) || !isFinite(amount) || amount <= 0 || !isFinite(rate) || rate <= 0) continue;
    rates[code] = rate / amount;   // normalise to CZK per 1 unit
  }
  if (!Object.keys(rates).length) throw new Error('No rate rows parsed from ČNB feed');
  return { date, rates };
}

/**
 * Fetch the latest ČNB daily fixing (or a specific date via ?date=DD.MM.YYYY).
 * @param dateIso optional YYYY-MM-DD to backfill a past day
 */
export async function fetchCnbFixing(dateIso?: string): Promise<CnbFixing> {
  let url = CNB_DAILY_URL;
  if (dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    const [y, mo, d] = dateIso.split('-');
    url += `?date=${d}.${mo}.${y}`;
  }
  return parseCnbDaily(await fetchText(url));
}

async function orgId(): Promise<string | null> {
  try { return await requireOrganizationId(); } catch { return null; }
}

export interface CnbSyncResult {
  date: string;
  upserted: string[];
  skipped: string[];
}

/**
 * Fetch a fixing and upsert the requested currencies as <CUR>→CZK into
 * finance_exchange_rates (effective_from = fixing date). Idempotent.
 */
export async function syncCnbRates(
  opts: { date?: string; currencies?: string[]; organizationId?: string; fixing?: CnbFixing } = {},
): Promise<CnbSyncResult> {
  // `organizationId` явно — бо цю функцію кличе крон, а крон обходить УСІ
  // готелі. `orgId()` під ним повертав null (`requireOrganizationId` кидає,
  // щойно готелів більше одного), і весь виклик закінчувався 502: курси не
  // оновлювались ні для кого. Ambient лишається для ручного виклику з
  // кабінету, де орендар уже на місці.
  const oid = opts.organizationId ?? await orgId();
  if (!oid) throw new Error('No organization found');
  const want = (opts.currencies || DEFAULT_CNB_CURRENCIES).map(c => c.toUpperCase());

  // Фіксинг можна передати ззовні: крон тягне його ОДИН раз і роздає по
  // готелях. Інакше сотня готелів — сотня однакових запитів до ČNB за той
  // самий день, і банк має повне право нас відсікти.
  const fixing = opts.fixing ?? await fetchCnbFixing(opts.date);
  const sql = getSql();

  const upserted: string[] = [];
  const skipped: string[] = [];
  // One fixing is one day's rates: a half-written set would price part of a
  // day at yesterday's rate.
  //
  // `runWithOrganization` — бо на Postgres політика `finance_exchange_rates`
  // звіряє `app.organization_id` на ЗʼЄДНАННІ (інваріант 11). Правильний
  // `organization_id` у самому INSERT цього не замінює: рядок відхиляється
  // політикою, а не приймається.
  await runWithOrganization(oid, () => sql.tx(async (t) => {
    for (const cur of want) {
      const rate = fixing.rates[cur];
      if (rate == null) { skipped.push(cur); continue; }
      await t.run(`
        INSERT INTO finance_exchange_rates (organization_id, from_currency, to_currency, rate, effective_from)
        VALUES (?, ?, 'CZK', ?, ?)
        ON CONFLICT(organization_id, from_currency, to_currency, effective_from)
        DO UPDATE SET rate = excluded.rate
      `, [oid, cur, rate, fixing.date]);
      upserted.push(cur);
    }
  }));

  return { date: fixing.date, upserted, skipped };
}

// ─── Cached EUR/CZK mid-rate ─────────────────────────────────────────────────
//
// This lived inside the Hostex client with its own private copy of the ČNB
// fetch — an FX question hiding in a channel-manager file, which is why the
// pricing module and the Booking.com import were importing '@/lib/hostex' to
// convert currency. Same feed, one parser, one cache.

let cachedEurCzk: { rate: number; fetchedAt: number } | null = null;
const EUR_CZK_CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function getEurCzkRate(): Promise<number> {
  if (cachedEurCzk && Date.now() - cachedEurCzk.fetchedAt < EUR_CZK_CACHE_MS) {
    return cachedEurCzk.rate;
  }
  try {
    const fixing = await fetchCnbFixing();
    const rate = fixing.rates['EUR'];
    if (!rate) throw new Error('ČNB feed has no EUR row');
    cachedEurCzk = { rate, fetchedAt: Date.now() };
    return rate;
  } catch (e) {
    console.error('[CNB] EUR/CZK fetch failed, using fallback:', (e as Error).message);
    return cachedEurCzk?.rate || 25.2;
  }
}
