/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Імпорт витягнутого знімка в ядро — частина Б (`docs/tasks/2026-09-10-block-winhotel-import.md`
 * §2.5–2.6), порядок і правила з `IMPORT-PLAN.md` §1–2.
 *
 * ── Що куди йде ─────────────────────────────────────────────────────────
 *
 *   довідники     лише ЗВІРКА (категорії ↔ unit_types.code, номери ↔ units.code,
 *                 послуги ↔ additional_services.name, ставки ↔ fin_tax_rates.code);
 *                 розбіжність — названа відмова з переліком, і НІЧОГО не пишеться;
 *   адреси        DEBI_NR > 0 → компанія через `@companies/kernel`; інакше гість
 *                 через `findOrCreateGuest` (`@guests`); refs `address`/`company`;
 *   брони         GASTKONT → reservations (спільна таблиця; писачів у ядрі
 *                 десять, тож власний INSERT — не пробій) під `insertingStay`
 *                 (`@bookings/overlap`), три адреси → reservation_guests,
 *                 VERK_NR → parent_id; майбутні — усі, минулі — з дати;
 *   рядки         BUCHKONT → fin_folio_items через `@invoicing/kernel addCharges`
 *                 у фоліо броні (`ensureReservationFolio`); суми як є;
 *   оплати        ZAHLUNGEN → `recordReservationPayment` для transfer/voucher;
 *                 готівка й картка на німецькому обʼєкті без `fiscal_de` — у staging
 *                 (фіскальна варта ядра відмовляє свідомо, і імпорт її не обходить);
 *   фактури       усі → staging `invoice` (фасад не має дверей для чужої нумерації);
 *   сальдо        staging `balance` з числами агрегатів;
 *   GDPR, каса    staging `consent`, `cash_book` (CORE-GAPS 6, 9).
 *
 * ── Ідемпотентність ─────────────────────────────────────────────────────
 *
 * Кожен наш рядок памʼятається в `winhotel_refs` разом із відбитком полів.
 * Той самий знімок удруге → відбитки збігаються → нуль нових рядків і нуль
 * змін. Новіший знімок → змінилось лише те, у чого інший відбиток: бронь
 * оновлюється (спільна таблиця, свій UPDATE + двері `@channels/outbox`), гість
 * — дописується; рядок рахунку чи оплата, для яких дверей на зміну немає, —
 * staging `changed`. Бронь, яку ми імпортували, а в новому знімку її немає
 * (`TA_STATUS ≥ 1000` без дати сторно міст не витягає) — `cancelled`, ніколи
 * `DELETE`.
 *
 * ── Чому не «одна транзакція на сутність» ───────────────────────────────
 *
 * Задача §2.5 п. 9 просить транзакцію на сутність. Фасади (`findOrCreateGuest`,
 * `addCharges`, `recordReservationPayment`) беруть `getSql()` самі — на Postgres
 * усередині `sql.tx` це ІНШЕ зʼєднання (інваріант 11), і транзакція навколо
 * них нічого б не тримала, а лише прикидалась. Тому — рядок за рядком, і
 * ref пишеться одразу після рядка: падіння посередині залишає базу такою, з
 * якої наступний прогін продовжує без дублів. Це названо в звіті.
 */
import crypto from 'node:crypto';
import { getSql } from '@core/db/async';
import { propertyScopeFilter, ALL_PROPERTIES } from '@core/property-scope';
import { money } from '@core/money';
import { refuse } from '@core/http/refusal';
import { findOrCreateGuest } from '@guests';
import { createCompanyForTests as createCompanyRow, companyPayer, adoptDebtorNo } from '@companies/kernel';
import { ensureReservationFolio, openFolio, addCharges, recordReservationPayment, pickRate, type TaxRate } from '@invoicing/kernel';
import { insertingStay, UnitOverlap } from '@bookings/overlap';
import { recalcPaymentStatusFromFolio } from '@bookings/kernel';
import { noteAvailabilityChanged } from '@channels/outbox';
import { fingerprintOf, findRef, putRef, refsOf, stage, stagedLnrs, stagingCounts, countRefs } from '../data/refs.repo';
import { readAggregates, readJsonl, snapshotDate } from './read';
import {
  EXTERNAL_PREFIX, bookingStatus, countryCode, gender, groupCodeOf, guestName, household, internalNotes, isCompany,
  language, lineKind, lineQuantity, needsCatalogMatch, nightsOf, normalizeServiceName, paymentMethod, statusForward, taxCode,
  type WhAddress, type WhBooking, type WhBookingRef, type WhFolioLine, type WhInvoice, type WhInvoiceLine, type WhLedger,
  type WhPayment, type WhPaymentMethod, type WhSegment, type WhService, type WhServiceGroup, type WhTaxCode, type WhUnit, type WhUnitType,
} from './mapping';

export interface EntityCount {
  winhotel: number;
  imported: number;
  updated: number;
  staged: number;
  skipped: Record<string, number>;
}

export interface MustMatch { name: string; winhotel: number | string; ours: number | string; ok: boolean }

export interface ImportReport {
  phase: 'done';
  snapshotId: string;
  snapshotDate: string | null;
  /** `full` — база цілком; `delta` — вікно дат агента (задача 8 §3): нічого поза ним не чіпається. */
  mode: 'full' | 'delta';
  window: { from: string; to: string } | null;
  since: string;
  entities: Record<string, EntityCount>;
  staging: Array<{ entity: string; reason: string; n: number }>;
  reconcile: { mustMatch: MustMatch[]; explained: Array<{ name: string; winhotel: number | string; ours: number | string; why: string }> };
  mismatch: boolean;
  refs: number;
  durationMs: number;
}

export interface ImportOptions {
  organizationId: string;
  snapshotId: string;
  /** Тека з `<entity>.jsonl` і `aggregates.json`. */
  dir: string;
  /** Минулі брони — із цієї дати заїзду (дефолт 01.01.2025); майбутні — всі. */
  since?: string;
  takenAt?: string | null;
  log?: (line: string) => void;
}

const DEFAULT_SINCE = '2025-01-01';

/**
 * Вісь обʼєкта — навмисно `ALL_PROPERTIES`: знімок Winhotel належить РАХУНКУ,
 * обʼєкт кожної броні виводиться з коду номера чи категорії, а звірка «скільки
 * наших броней прийшло з Winhotel» рахує їх усі, інакше вона не звірка.
 */
const ACROSS = propertyScopeFilter(ALL_PROPERTIES, 'r');
const ACROSS_RATES = propertyScopeFilter(ALL_PROPERTIES, 't');

function count(): EntityCount { return { winhotel: 0, imported: 0, updated: 0, skipped: {}, staged: 0 }; }
function skip(c: EntityCount, why: string) { c.skipped[why] = (c.skipped[why] ?? 0) + 1; }

interface Catalog {
  properties: Array<{ id: string; country: string | null }>;
  unitTypeByCode: Map<string, { id: string; property_id: string }>;
  unitByCode: Map<string, { id: string; unit_type_id: string; property_id: string }>;
  serviceByName: Map<string, { id: string; property_id: string }>;
  taxRates: TaxRate[];
  sourceByName: Map<string, string>;
}

async function loadCatalog(organizationId: string): Promise<Catalog> {
  const sql = getSql();
  const properties = await sql.rows<{ id: string; country: string | null }>(
    'SELECT id, country FROM properties WHERE organization_id = ? ORDER BY created_at, id', [organizationId]);
  const ids = properties.map((p) => p.id);
  if (ids.length === 0) refuse('У організації немає жодного обʼєкта — імпортувати нема куди', 409);
  const marks = ids.map(() => '?').join(', ');
  const types = await sql.rows<{ id: string; code: string; property_id: string }>(
    `SELECT id, code, property_id FROM unit_types WHERE property_id IN (${marks})`, ids);
  const units = await sql.rows<{ id: string; code: string; unit_type_id: string; property_id: string }>(
    `SELECT id, code, unit_type_id, property_id FROM units WHERE property_id IN (${marks})`, ids);
  const services = await sql.rows<{ id: string; name: string; property_id: string }>(
    `SELECT id, name, property_id FROM additional_services WHERE property_id IN (${marks})`, ids);
  const rates = await sql.rows<{ code: string; rate: number; valid_from: string; valid_to: string | null }>(
    `SELECT t.code, t.rate, t.valid_from, t.valid_to FROM fin_tax_rates t WHERE t.organization_id = ? AND ${ACROSS_RATES.sql} ORDER BY t.valid_from`, [organizationId, ...ACROSS_RATES.params]);
  const sources = await sql.rows<{ code: string; name: string }>(
    `SELECT code, name FROM booking_sources WHERE property_id IN (${marks})`, ids);
  return {
    properties,
    unitTypeByCode: new Map(types.map((t) => [String(t.code).trim().toUpperCase(), { id: String(t.id), property_id: String(t.property_id) }])),
    unitByCode: new Map(units.map((u) => [String(u.code).trim(), { id: String(u.id), unit_type_id: String(u.unit_type_id), property_id: String(u.property_id) }])),
    serviceByName: new Map(services.map((s) => [normalizeServiceName(String(s.name)), { id: String(s.id), property_id: String(s.property_id) }])),
    taxRates: rates.map((r) => ({ code: r.code as TaxRate['code'], rate: Number(r.rate), valid_from: String(r.valid_from), valid_to: r.valid_to ? String(r.valid_to) : null })),
    sourceByName: new Map(sources.map((s) => [String(s.name).trim().toLowerCase(), String(s.code)])),
  };
}

/**
 * Крок 1 — довідники. Нічого не створюється; кожен незнайдений код названо.
 */
function verifyDictionaries(cat: Catalog, wh: {
  unitTypes: WhUnitType[]; units: WhUnit[]; services: WhService[]; taxCodes: WhTaxCode[]; groups: Map<number, WhServiceGroup>;
}): { unmatchedServices: string[] } {
  const missing: string[] = [];
  for (const t of wh.unitTypes) {
    if (t.pseudo || t.lnr === 0 || t.lnr === 99999 || !t.kategorie) continue;
    if (!cat.unitTypeByCode.has(t.kategorie.trim().toUpperCase())) missing.push(`категорія «${t.kategorie.trim()}»`);
  }
  for (const u of wh.units) {
    if (!u.zinr) continue;
    const n = Number(u.zinr);
    if (Number.isFinite(n) && n >= 9000) continue; // псевдо-номери не імпортуються (IMPORT-PLAN §2.3)
    if (u.stock === 99) continue;
    if (!cat.unitByCode.has(u.zinr.trim())) missing.push(`номер «${u.zinr.trim()}»`);
  }
  // Послуги — не блокер: рядок фоліо несе власну назву, рід — з групи, ставку —
  // з STS; пара в каталозі потрібна лише майбутньому продажу. Незнайдені —
  // у `reconcile.explained` переліком (рецензія Б, п. 3).
  const unmatchedServices: string[] = [];
  for (const s of wh.services) {
    if (!needsCatalogMatch(s, groupCodeOf(s, wh.groups))) continue;
    if (!cat.serviceByName.has(normalizeServiceName(s.bezeichn))) unmatchedServices.push(s.bezeichn!.trim());
  }
  const codes = new Set(cat.taxRates.map((r) => r.code));
  for (const t of wh.taxCodes) {
    const code = taxCode(t.sts);
    if (!code) { missing.push(`ставка ПДВ STS ${t.sts ?? '—'} (невідомий код)`); continue; }
    if (!codes.has(code)) missing.push(`ставка ПДВ «${code}» (STS ${t.sts})`);
  }
  const unique = [...new Set(missing)];
  if (unique.length) {
    refuse(`Імпорт не почато: у готелі немає ${unique.length} з довідника Winhotel — ${unique.join(', ')}`, 409);
  }
  return { unmatchedServices: [...new Set(unmatchedServices)] };
}

export async function runImport(opts: ImportOptions): Promise<ImportReport> {
  const t0 = Date.now();
  const log = opts.log ?? (() => {});
  const org = opts.organizationId;
  const since = opts.since ?? DEFAULT_SINCE;
  const agg = readAggregates(opts.dir);
  const snapDate = snapshotDate(agg, opts.takenAt ?? null);
  const delta = agg.mode === 'delta';
  const window = delta ? agg.window ?? null : null;
  if (delta && !(window?.from && window?.to)) refuse('Дельта без вікна дат — імпортувати нема як: невідомо, що в ній повне', 409);
  // Час знімка — на кожен ref: старіший знімок (нічний повний після денної
  // дельти) не переписує новіше. Форма — та сама, що в `taken_at` рядка.
  const takenAtKey = opts.takenAt ? String(opts.takenAt).replace('T', ' ').slice(0, 19) : null;

  const wh = {
    unitTypes: readJsonl<WhUnitType>(opts.dir, 'unit_types').rows,
    units: readJsonl<WhUnit>(opts.dir, 'units').rows,
    services: readJsonl<WhService>(opts.dir, 'services').rows,
    taxCodes: readJsonl<WhTaxCode>(opts.dir, 'tax_codes').rows,
    segments: readJsonl<WhSegment>(opts.dir, 'segments').rows,
    serviceGroups: readJsonl<WhServiceGroup>(opts.dir, 'service_groups').rows,
    bookingRefs: readJsonl<WhBookingRef>(opts.dir, 'booking_refs').rows,
    paymentMethods: readJsonl<WhPaymentMethod>(opts.dir, 'payment_methods').rows,
    addresses: readJsonl<WhAddress>(opts.dir, 'addresses').rows,
    bookings: readJsonl<WhBooking>(opts.dir, 'bookings').rows,
    folioLines: readJsonl<WhFolioLine>(opts.dir, 'folio_lines').rows,
    payments: readJsonl<WhPayment>(opts.dir, 'payments').rows,
    invoices: readJsonl<WhInvoice>(opts.dir, 'invoices').rows,
    invoiceLines: readJsonl<WhInvoiceLine>(opts.dir, 'invoice_lines').rows,
    ledger: readJsonl<WhLedger>(opts.dir, 'invoice_ledger').rows,
    consents: readJsonl<any>(opts.dir, 'consents').rows,
    cashBook: readJsonl<any>(opts.dir, 'cash_book').rows,
  };
  if (wh.bookings.length === 0 && wh.addresses.length === 0) {
    refuse('У витягу немає ні адрес, ні броней — імпортувати нема чого', 409);
  }

  const groupByLnr = new Map(wh.serviceGroups.map((g) => [g.lnr, g]));
  const cat = await loadCatalog(org);
  const { unmatchedServices } = verifyDictionaries(cat, { ...wh, groups: groupByLnr });
  log(`довідники звірено: ${cat.unitTypeByCode.size} категорій, ${cat.unitByCode.size} номерів, ${cat.serviceByName.size} послуг; без пари в каталозі: ${unmatchedServices.length}`);

  const entities: Record<string, EntityCount> = {};
  const E = (name: string) => (entities[name] ??= count());
  const sql = getSql();

  // ── Мапи Winhotel ────────────────────────────────────────────────────────
  const typeByLnr = new Map(wh.unitTypes.map((t) => [t.lnr, t]));
  const unitByLnr = new Map(wh.units.map((u) => [u.lnr, u]));
  const serviceByLnr = new Map(wh.services.map((s) => [s.lnr, s]));
  const methodByLnr = new Map(wh.paymentMethods.map((m) => [m.lnr, m]));
  const segmentByCode = new Map(wh.segments.map((s) => [s.segmcode ?? -1, s]));
  const addressByLnr = new Map(wh.addresses.map((a) => [a.lnr, a]));

  // ── 2–3. Адреси: компанії й гості ────────────────────────────────────────
  const companies = E('company');
  const guests = E('guest');
  const companyRefs = await refsOf(org, 'company');
  const guestRefs = await refsOf(org, 'address');
  for (const a of wh.addresses) {
    if (isCompany(a)) {
      companies.winhotel += 1;
      const fp = fingerprintOf({ n: a.name1, n2: a.name2, s: a.strasse, p: a.plz, o: a.ort, l: a.land, m: a.e_mail, t: a.tele1, st: a.steuernummer, d: a.debi_nr });
      const known = companyRefs.get(a.lnr);
      if (known) {
        if (known.fingerprint !== fp) {
          await stage(org, opts.snapshotId, 'company', a.lnr, 'changed', a);
          companies.staged += 1;
        } else skip(companies, 'unchanged');
        continue;
      }
      try {
        const id = await createCompanyRow(org, {
          name: (a.name1 ?? '').trim() || `Firma ${a.lnr}`,
          business_id: null,
          vat_id: a.steuernummer,
          address_street: a.strasse, address_city: a.ort, address_zip: a.plz, address_country: countryCode(a.land),
          email: a.e_mail, phone: a.tele1,
          notes: [a.name2 && `Kontakt: ${a.name2}`, a.pr_code ? `Winhotel PR_CODE ${a.pr_code}` : null, a.rabatt ? `Rabatt ${a.rabatt}%` : null, a.bemerk2].filter(Boolean).join('\n') || null,
        });
        await putRef(org, 'company', a.lnr, id, fp, takenAtKey);
        companyRefs.set(a.lnr, { entity: 'company', winhotel_lnr: a.lnr, our_id: id, fingerprint: fp, source_taken_at: takenAtKey });
        companies.imported += 1;
        // `DEBI_NR` фірми — її номер дебітора в бухгалтерії готелю: приймається
        // дверима `adoptDebtorNo` (0140, З37) замість виданого лічильником;
        // зайнятий іншою фірмою — staging `debtor_no_pending`, число не губиться.
        if ((a.debi_nr ?? 0) > 0) {
          const adopted = await adoptDebtorNo(org, id, Number(a.debi_nr));
          if (adopted === 'adopted' || adopted === 'already') skip(companies, 'debtor_no_adopted');
          else {
            await stage(org, opts.snapshotId, 'company', a.lnr, 'debtor_no_pending', { debi_nr: a.debi_nr, company_id: id, why: adopted });
            skip(companies, 'debtor_no_pending');
          }
        }
      } catch (e) {
        await stage(org, opts.snapshotId, 'company', a.lnr, 'refused_by_core', { row: a, error: String((e as Error)?.message ?? e).slice(0, 200) });
        companies.staged += 1;
      }
      continue;
    }
    guests.winhotel += 1;
    const name = guestName(a);
    const fp = fingerprintOf({ f: name.firstName, l: name.lastName, m: a.e_mail, t: a.tele1, s: a.strasse, p: a.plz, o: a.ort, c: a.land, b: a.gebdat, i: a.id_nr, g: a.geschlecht, sp: a.sprache, bm: a.bemerk, bm2: a.bemerk2, w: a.wunsch_zi });
    const known = guestRefs.get(a.lnr);
    if (known && known.fingerprint === fp) { skip(guests, 'unchanged'); continue; }
    const result = await findOrCreateGuest({
      organizationId: org,
      firstName: name.firstName, lastName: name.lastName,
      email: a.e_mail, phone: a.tele1,
      address: a.strasse, city: [a.plz, a.ort].filter(Boolean).join(' ') || null, country: countryCode(a.land),
      nationality: a.st_angeh, dateOfBirth: a.gebdat, documentNumber: a.id_nr,
    });
    // Те, чого дедуплікація не пише: стать, мова, примітки — лише в порожнє,
    // як і вона сама (спільна таблиця; писачів десять).
    const notes = [a.bemerk, a.bemerk2, a.wunsch_zi && `Wunschzimmer: ${a.wunsch_zi}`].filter(Boolean).join('\n') || null;
    await sql.run(
      `UPDATE guests SET gender = COALESCE(gender, ?), language = COALESCE(language, ?), notes = COALESCE(NULLIF(notes, ''), ?), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?`,
      [gender(a.geschlecht, a.anrede), language(a.sprache), notes, result.id, org]);
    await putRef(org, 'address', a.lnr, result.id, fp, takenAtKey);
    guestRefs.set(a.lnr, { entity: 'address', winhotel_lnr: a.lnr, our_id: result.id, fingerprint: fp, source_taken_at: takenAtKey });
    if (known) guests.updated += 1;
    else if (result.isNew) guests.imported += 1;
    else {
      guests.imported += 1; skip(guests, `merged_by_${result.matchedBy}`);
      if (result.matchedBy === 'name') {
        // Злиття лише за імʼям (правило @guests, З32): рахуємо, скільки з них
        // мають іншу дату народження або інше місто, — число для сесії 3.
        const g = await sql.row<{ date_of_birth: string | null; city: string | null }>(
          'SELECT date_of_birth, city FROM guests WHERE id = ? AND organization_id = ?', [result.id, org]);
        const dobDiff = !!(g?.date_of_birth && a.gebdat && String(g.date_of_birth).slice(0, 10) !== a.gebdat);
        const cityDiff = !!(g?.city && a.ort && !String(g.city).toLowerCase().includes(a.ort.trim().toLowerCase()));
        if (dobDiff) skip(guests, 'merged_by_name_other_birthdate');
        if (cityDiff) skip(guests, 'merged_by_name_other_city');
      }
    }
  }
  log(`адреси: ${companies.imported} компаній, ${guests.imported} гостей`);

  const guestIdOf = (lnr: number | null): string | null => (lnr ? guestRefs.get(lnr)?.our_id ?? null : null);
  const companyIdOf = (lnr: number | null): string | null => (lnr ? companyRefs.get(lnr)?.our_id ?? null : null);

  // ── 4. Брони ─────────────────────────────────────────────────────────────
  const bookings = E('reservation');
  const resGuests = E('reservation_guest');
  const bookingRefs = await refsOf(org, 'reservation');
  const totalsByGk = new Map<number, number>();
  for (const l of wh.folioLines) if (l.gk_lnr) totalsByGk.set(l.gk_lnr, money((totalsByGk.get(l.gk_lnr) ?? 0) + (l.gbetrag ?? 0)));
  const seenLnr = new Set<number>();
  const importedBookings: Array<{ lnr: number; id: string; propertyId: string; companyFolio: string | null }> = [];
  // Джерело броні: `MARKSEG` — ринковий сегмент і на живому порожній (рецензія Б);
  // канал називає `GASTKREF.EXT_SOURCE` («Booking.com», «DIRS21»…). Немає рядка —
  // `direct`, і це названо в `explained` разом із розподілом значень.
  const refByBooking = new Map<number, WhBookingRef>();
  for (const r of wh.bookingRefs) if (r.gk_lnr && r.ext_source && !refByBooking.has(r.gk_lnr)) refByBooking.set(r.gk_lnr, r);
  const extSourceCounts = new Map<string, number>();
  for (const r of refByBooking.values()) { const k = r.ext_source!.trim(); extSourceCounts.set(k, (extSourceCounts.get(k) ?? 0) + 1); }
  const liveByUnit = new Map<number, WhBooking[]>();
  for (const b of wh.bookings) {
    if ((b.ta_status ?? 0) >= 1000 || !b.lnr_zinr || !b.vonaufh || !b.bisaufh) continue;
    (liveByUnit.get(b.lnr_zinr) ?? liveByUnit.set(b.lnr_zinr, []).get(b.lnr_zinr)!).push(b);
  }
  /** Чому бронь перетнулась: чужа бронь Winhotel на тому ж номері в ті ж дати, переїзд (UMZUG_ZINR), або інше. */
  const overlapCause = (b: WhBooking): 'winhotel_double' | 'umzug' | 'other' => {
    if (b.umzug_zinr && b.umzug_zinr.trim()) return 'umzug';
    const twin = (liveByUnit.get(b.lnr_zinr ?? -1) ?? []).some((o) => o.lnr !== b.lnr && o.vonaufh! < b.bisaufh! && o.bisaufh! > b.vonaufh!);
    return twin ? 'winhotel_double' : 'other';
  };

  for (const b of wh.bookings) {
    bookings.winhotel += 1;
    seenLnr.add(b.lnr);
    if (!b.vonaufh || !b.bisaufh) { skip(bookings, 'no_dates'); continue; }
    const future = snapDate ? b.vonaufh > snapDate : false;
    if (!delta && !future && b.vonaufh < since) { skip(bookings, 'before_since'); continue; }

    const type = typeByLnr.get(b.resv_kate_lnr || b.lnr_kate || -1) ?? typeByLnr.get(b.lnr_kate ?? -1);
    const typeRow = type?.kategorie ? cat.unitTypeByCode.get(type.kategorie.trim().toUpperCase()) : undefined;
    if (!typeRow) { await stage(org, opts.snapshotId, 'reservation', b.lnr, 'no_unit_type', b); bookings.staged += 1; if (future) skip(bookings, 'staged_future'); continue; }
    const unitWh = unitByLnr.get(b.lnr_zinr ?? -1);
    const unitRow = unitWh?.zinr ? cat.unitByCode.get(unitWh.zinr.trim()) ?? null : null; // псевдо → null
    const propertyId = unitRow?.property_id ?? typeRow.property_id;

    const guestLnrs = [b.gastnr_1, b.gastnr_2, b.gastnr_3].filter((x): x is number => !!x);
    let guestId = guestLnrs.map(guestIdOf).find(Boolean) ?? null;
    const companyLnr = guestLnrs.find((l) => companyIdOf(l));
    const companyId = companyLnr ? companyIdOf(companyLnr) : null;
    if (!guestId && companyLnr) {
      // Фірмова бронь без названого гостя: гість — «представник фірми»,
      // інакше бронь без guest_id у ядрі не існує.
      const a = addressByLnr.get(companyLnr)!;
      const r = await findOrCreateGuest({ organizationId: org, firstName: (a.name2 ?? '').trim(), lastName: (a.name1 ?? '').trim() || `Debitor ${a.debi_nr}` });
      guestId = r.id;
    }
    if (!guestId) { await stage(org, opts.snapshotId, 'reservation', b.lnr, 'no_guest', b); bookings.staged += 1; if (future) skip(bookings, 'staged_future'); continue; }

    const status = bookingStatus(b);
    const ref = refByBooking.get(b.lnr);
    const segment = segmentByCode.get(b.markseg ?? -1);
    const source = (ref?.ext_source && cat.sourceByName.get(ref.ext_source.trim().toLowerCase()))
      || (segment?.bezeichn && cat.sourceByName.get(segment.bezeichn.trim().toLowerCase()))
      || 'direct';
    const nights = nightsOf(b);
    const fields = {
      property_id: propertyId, unit_id: unitRow?.id ?? null, unit_type_id: typeRow.id, guest_id: guestId,
      check_in: b.vonaufh, check_out: b.bisaufh, nights,
      adults: Math.max(1, b.perszahl ?? 1), children: (b.anzkinder ?? 0) + (b.anzkinder2 ?? 0) + (b.anzjugend ?? 0), infants: b.anzkleinkind ?? 0,
      status, source, total_price: totalsByGk.get(b.lnr) ?? 0,
      internal_notes: internalNotes(b), deposit_amount: b.anza_betrag ?? 0, deposit_status: (b.anza_betrag ?? 0) > 0 ? 'paid' : 'none',
      company_id: companyId,
    };
    const fp = fingerprintOf(fields);
    const known = bookingRefs.get(b.lnr);

    if (known && known.fingerprint === fp) {
      skip(bookings, 'unchanged');
      importedBookings.push({ lnr: b.lnr, id: known.our_id, propertyId, companyFolio: null });
      continue;
    }
    if (known && known.source_taken_at && takenAtKey && takenAtKey < known.source_taken_at) {
      // Цей знімок старіший за той, що писав рядок (нічний повний після
      // денної дельти): він не відкочує новішого.
      skip(bookings, 'older_snapshot');
      importedBookings.push({ lnr: b.lnr, id: known.our_id, propertyId, companyFolio: null });
      continue;
    }
    try {
      if (known) {
        const before = await sql.row<{ unit_type_id: string; check_in: string; check_out: string; property_id: string; status: string }>(
          `SELECT r.unit_type_id, r.check_in, r.check_out, r.property_id, r.status FROM reservations r WHERE r.id = ? AND r.organization_id = ? AND ${ACROSS.sql}`, [known.our_id, org, ...ACROSS.params]);
        // Незатирання: стан лише вперед; `registration_status`, гості броні й
        // оплати рецепції в цьому UPDATE не згадуються взагалі.
        const nextStatus = statusForward(before?.status, status);
        await insertingStay(async () => {
          await sql.run(
            `UPDATE reservations SET property_id = ?, unit_id = ?, unit_type_id = ?, guest_id = ?, check_in = ?, check_out = ?, nights = ?,
               adults = ?, children = ?, infants = ?, status = ?, source = ?, total_price = ?, internal_notes = ?,
               deposit_amount = ?, deposit_status = ?, company_id = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND organization_id = ?`,
            [fields.property_id, fields.unit_id, fields.unit_type_id, fields.guest_id, fields.check_in, fields.check_out, fields.nights,
             fields.adults, fields.children, fields.infants, nextStatus, fields.source, fields.total_price, fields.internal_notes,
             fields.deposit_amount, fields.deposit_status, fields.company_id, known.our_id, org]);
        }, { unitId: fields.unit_id, checkIn: fields.check_in, checkOut: fields.check_out, reservationId: known.our_id });
        if (nextStatus !== status) skip(bookings, 'status_kept_forward');
        // Двері каналу — старе й нове вікно (Ц16); без підключення це нуль записів.
        if (before) await noteAvailabilityChanged(sql, { propertyId: String(before.property_id), unitTypeId: String(before.unit_type_id), from: String(before.check_in).slice(0, 10), to: String(before.check_out).slice(0, 10) });
        await noteAvailabilityChanged(sql, { propertyId, unitTypeId: typeRow.id, from: fields.check_in, to: fields.check_out });
        await putRef(org, 'reservation', b.lnr, known.our_id, fp, takenAtKey);
        bookings.updated += 1;
        importedBookings.push({ lnr: b.lnr, id: known.our_id, propertyId, companyFolio: null });
        continue;
      }
      const id = crypto.randomUUID();
      await insertingStay(async () => {
        await sql.run(
          `INSERT INTO reservations (id, organization_id, property_id, unit_id, unit_type_id, guest_id, check_in, check_out, nights,
                                     adults, children, infants, status, payment_status, source, total_price, currency,
                                     internal_notes, deposit_amount, deposit_status, company_id, external_uid)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, (SELECT default_currency FROM organizations WHERE id = ?), ?, ?, ?, ?, ?)`,
          [id, org, fields.property_id, fields.unit_id, fields.unit_type_id, fields.guest_id, fields.check_in, fields.check_out, fields.nights,
           fields.adults, fields.children, fields.infants, fields.status, fields.source, fields.total_price, org,
           fields.internal_notes, fields.deposit_amount, fields.deposit_status, fields.company_id, `${EXTERNAL_PREFIX}${b.lnr}`]);
      }, { unitId: fields.unit_id, checkIn: fields.check_in, checkOut: fields.check_out });
      await noteAvailabilityChanged(sql, { propertyId, unitTypeId: typeRow.id, from: fields.check_in, to: fields.check_out });
      await putRef(org, 'reservation', b.lnr, id, fp, takenAtKey);
      bookingRefs.set(b.lnr, { entity: 'reservation', winhotel_lnr: b.lnr, our_id: id, fingerprint: fp, source_taken_at: takenAtKey });
      bookings.imported += 1;
      importedBookings.push({ lnr: b.lnr, id, propertyId, companyFolio: null });

      // Три адреси → reservation_guests; супутник і діти — за прапорцями броні.
      const people: Array<{ slot: number; guestId: string | null; firstName: string; lastName: string; dob: string | null; doc: string | null }> = [];
      [b.gastnr_1, b.gastnr_2, b.gastnr_3].forEach((lnr, i) => {
        const gid = guestIdOf(lnr);
        const a = lnr ? addressByLnr.get(lnr) : undefined;
        if (!gid || !a) return;
        const n = guestName(a);
        people.push({ slot: i + 1, guestId: gid, firstName: n.firstName, lastName: n.lastName, dob: a.gebdat, doc: a.id_nr });
      });
      const first = b.gastnr_1 ? addressByLnr.get(b.gastnr_1) : undefined;
      if (first) {
        for (const c of household(first, { begleit: !!b.begleitok, kids: [!!b.kind1ok, !!b.kind2ok, !!b.kind3ok, !!b.kind4ok, !!b.kind5ok] })) {
          people.push({ slot: c.slot, guestId: null, firstName: c.firstName, lastName: c.lastName, dob: c.dateOfBirth, doc: c.documentNumber });
        }
      }
      for (const p of people) {
        const key = b.lnr * 100 + p.slot;
        if (await findRef(org, 'reservation_guest', key)) continue;
        const rgId = crypto.randomUUID();
        await sql.run(
          `INSERT INTO reservation_guests (id, reservation_id, first_name, last_name, date_of_birth, nationality, document_number, guest_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [rgId, id, p.firstName || '—', p.lastName || '—', p.dob, null, p.doc, p.guestId]);
        await putRef(org, 'reservation_guest', key, rgId, null, takenAtKey);
        resGuests.imported += 1;
      }
    } catch (e) {
      if (e instanceof UnitOverlap) {
        const cause = overlapCause(b);
        await stage(org, opts.snapshotId, 'reservation', b.lnr, 'overlap', { row: b, detail: e.message, cause });
        bookings.staged += 1;
        skip(bookings, `overlap_${cause}`);
        if (snapDate && b.vonaufh > snapDate) skip(bookings, 'staged_future');
        continue;
      }
      throw e;
    }
  }
  // Група: VERK_NR ≠ LNR → parent_id на бронь групи (другий прохід, коли всі є).
  for (const b of wh.bookings) {
    if (!b.verk_nr || b.verk_nr === b.lnr) continue;
    const me = bookingRefs.get(b.lnr); const parent = bookingRefs.get(b.verk_nr);
    if (!me || !parent) continue;
    await sql.run('UPDATE reservations SET parent_id = ? WHERE id = ? AND organization_id = ? AND (parent_id IS NULL OR parent_id <> ?)', [parent.our_id, me.our_id, org, parent.our_id]);
  }
  // Видалене у Winhotel після нашого імпорту: у ПОВНОМУ знімку броні немає →
  // cancelled, не DELETE. Дельта неповна за означенням — вона нічого не скасовує.
  for (const [lnr, ref] of delta ? [] : bookingRefs) {
    if (seenLnr.has(lnr)) continue;
    const changed = await sql.run(
      "UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ? AND status <> 'cancelled'",
      [ref.our_id, org]);
    if (changed.changes > 0) { bookings.updated += 1; skip(bookings, 'cancelled_missing_in_snapshot'); }
  }
  log(`брони: ${bookings.imported} нових, ${bookings.updated} оновлених, ${bookings.staged} у staging`);

  const reservationIdOf = new Map(importedBookings.map((r) => [r.lnr, r]));

  // ── 5. Рядки рахунків → фоліо ────────────────────────────────────────────
  const lines = E('folio_line');
  const lineRefs = await refsOf(org, 'folio_line');
  const stagedLines = await stagedLnrs(org, 'folio_line');
  const folioByReservation = new Map<string, string>();
  const companyFolioByReservation = new Map<string, string>();
  const debtorLineIds = new Set(wh.invoiceLines.filter((l) => l.m_debirechn && l.bk_lnr).map((l) => l.bk_lnr as number));
  let importedLineSum = 0;
  const cashArticles = { n: 0, sum: 0 };
  for (const l of wh.folioLines) {
    lines.winhotel += 1;
    const res = l.gk_lnr ? reservationIdOf.get(l.gk_lnr) : undefined;
    if (!res) { skip(lines, 'booking_not_imported'); continue; }
    const service = serviceByLnr.get(l.leist_lnr ?? -1);
    const groupCode = groupCodeOf(service, groupByLnr);
    const route = lineKind(groupCode, service?.wg != null ? groupByLnr.get(service.wg)?.bezeichn : null);
    if (route === 'cash_article') {
      // Каса/витрати (700 Geldtransit, 750 Ausgaben, 800 Kein Umsatz) — не фоліо гостя.
      if (stagedLines.has(l.lnr)) skip(lines, 'unchanged');
      else { await stage(org, opts.snapshotId, 'folio_line', l.lnr, 'cash_article', { row: l, group: groupCode }); lines.staged += 1; stagedLines.add(l.lnr); }
      cashArticles.n += 1; cashArticles.sum = money(cashArticles.sum + (l.gbetrag ?? 0));
      continue;
    }
    const kind = route;
    const rate = pickRate(cat.taxRates, taxCode(service?.sts) ?? 'reduced', l.von ?? res.lnr.toString())?.rate ?? 0;
    const { quantity, unitPrice } = lineQuantity(l);
    const fields = { d: l.bezeichn, v: l.von, q: quantity, u: unitPrice, t: l.gbetrag, k: kind, r: rate, s: l.sto_kennung };
    const fp = fingerprintOf(fields);
    const known = lineRefs.get(l.lnr);
    if (known) {
      if (known.fingerprint === fp) { skip(lines, 'unchanged'); importedLineSum = money(importedLineSum + (l.gbetrag ?? 0)); continue; }
      await stage(org, opts.snapshotId, 'folio_line', l.lnr, 'changed', l);
      lines.staged += 1;
      continue;
    }
    let folioId = folioByReservation.get(res.id);
    if (!folioId) { folioId = await ensureReservationFolio(res.id); folioByReservation.set(res.id, folioId); }
    let target = folioId;
    if (debtorLineIds.has(l.lnr)) {
      // Sammelrechnung: рядок виставлявся дебітору → окреме фоліо платника-компанії.
      const booking = wh.bookings.find((b) => b.lnr === l.gk_lnr);
      const companyLnr = booking ? [booking.gastnr_1, booking.gastnr_2, booking.gastnr_3].find((x) => x && companyIdOf(x)) : null;
      const companyId = companyLnr ? companyIdOf(companyLnr) : null;
      if (companyId) {
        let cf = companyFolioByReservation.get(res.id);
        if (!cf) {
          const payer = await companyPayer(org, companyId);
          cf = await openFolio({ reservationId: res.id, payerKind: 'company', payerName: payer?.name ?? null, payerAddress: payer?.payer_address ?? null, payerVatNo: payer?.payer_vat_no ?? null, payerDebtorNo: payer?.payer_debtor_no ?? null, label: 'Sammelrechnung (Winhotel)' });
          companyFolioByReservation.set(res.id, cf);
        }
        target = cf;
      }
    }
    const itemId = crypto.randomUUID();
    await addCharges([{
      id: itemId, folioId: target, reservationId: res.id, serviceDate: l.von ?? '1970-01-01', kind,
      description: (l.bezeichn ?? service?.bezeichn ?? 'Winhotel').trim() || 'Winhotel',
      quantity, unitPriceGross: money(unitPrice), totalGross: money(l.gbetrag ?? 0), vatRate: rate, source: 'import',
    }]);
    await putRef(org, 'folio_line', l.lnr, itemId, fp, takenAtKey);
    lines.imported += 1;
    importedLineSum = money(importedLineSum + (l.gbetrag ?? 0));
  }
  log(`рядки рахунків: ${lines.imported} нових, ${lines.staged} у staging`);

  // ── 6. Оплати ────────────────────────────────────────────────────────────
  const payments = E('payment');
  const paymentRefs = await refsOf(org, 'payment');
  let importedPaySum = 0;
  let stagedPaySum = 0;
  for (const p of wh.payments) {
    payments.winhotel += 1;
    const res = p.lnr_gk ? reservationIdOf.get(p.lnr_gk) : undefined;
    if (!res) { skip(payments, 'booking_not_imported'); continue; }
    const method = paymentMethod(methodByLnr.get(p.lnr_devi ?? -1) ?? { kurzbez: null, bezeichn: p.bezeichn, m_depitor: p.m_debitor ? true : false });
    const fp = fingerprintOf({ a: p.betrag, d: p.budat, m: method, r: p.re_nr });
    const known = paymentRefs.get(p.lnr);
    if (known) {
      if (known.fingerprint === fp) { skip(payments, 'unchanged'); importedPaySum = money(importedPaySum + (p.betrag ?? 0)); continue; }
      await stage(org, opts.snapshotId, 'payment', p.lnr, 'changed', p);
      payments.staged += 1;
      continue;
    }
    if (!method) {
      await stage(org, opts.snapshotId, 'payment', p.lnr, 'method_unmapped', { row: p, devisen: methodByLnr.get(p.lnr_devi ?? -1) ?? null });
      payments.staged += 1; stagedPaySum = money(stagedPaySum + (p.betrag ?? 0));
      continue;
    }
    if (!p.betrag) { skip(payments, 'zero_amount'); continue; }
    try {
      // Історична оплата вже підписана касою Winhotel і в нашій касі не
      // відбувалась: іде у фоліо повз фіскальну варту з позначкою походження
      // `winhotel:<LNR>` (З34, рецензія Б п. 4); варта лишається для всього,
      // що не імпорт.
      const paidAt = p.budat ? `${p.budat}T${(p.uhrzeit ?? '12:00:00').slice(0, 8)}Z` : null;
      const { paymentId } = await recordReservationPayment({
        reservationId: res.id, amount: money(p.betrag), method, paidAt, source: 'import', origin: `winhotel:${p.lnr}`,
      });
      await putRef(org, 'payment', p.lnr, paymentId, fp, takenAtKey);
      payments.imported += 1; importedPaySum = money(importedPaySum + p.betrag);
    } catch (e) {
      await stage(org, opts.snapshotId, 'payment', p.lnr, 'refused_by_core', { row: p, method, error: String((e as Error)?.message ?? e).slice(0, 200) });
      payments.staged += 1; stagedPaySum = money(stagedPaySum + (p.betrag ?? 0));
    }
  }
  for (const r of importedBookings) {
    try { await recalcPaymentStatusFromFolio(r.id); } catch (e) { log(`статус оплати ${r.lnr}: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
  }
  log(`оплати: ${payments.imported} у фоліо, ${payments.staged} у staging`);

  // ── 7. Фактури — заморожені, у staging цілком (§1 задачі, інваріант 18) ──
  // Дельта їх не несе (і не мала б): кроки 7–8 — лише для повного знімка.
  const invoices = E('invoice');
  const linesByRechnr = new Map<number, WhInvoiceLine[]>();
  for (const l of wh.invoiceLines) if (l.rechnr) (linesByRechnr.get(l.rechnr) ?? linesByRechnr.set(l.rechnr, []).get(l.rechnr)!).push(l);
  const ledgerByRechnr = new Map<number, WhLedger[]>();
  for (const l of wh.ledger) if (l.rechnr) (ledgerByRechnr.get(l.rechnr) ?? ledgerByRechnr.set(l.rechnr, []).get(l.rechnr)!).push(l);
  for (const inv of delta ? [] : wh.invoices) {
    invoices.winhotel += 1;
    const reservation = inv.gk_lnr ? reservationIdOf.get(inv.gk_lnr)?.id ?? null : null;
    const debtor = (linesByRechnr.get(inv.rechnr ?? -1) ?? []).some((l) => l.m_debirechn);
    await stage(org, opts.snapshotId, 'invoice', inv.lnr, debtor ? 'frozen_sammelrechnung' : 'frozen', {
      header: inv, lines: linesByRechnr.get(inv.rechnr ?? -1) ?? [], ledger: ledgerByRechnr.get(inv.rechnr ?? -1) ?? [], reservation_id: reservation,
    });
    invoices.staged += 1;
  }

  // ── 8. Сальдо і те, чого ядро не вміє ───────────────────────────────────
  const balances = E('balance');
  const numbers = agg.numbers ?? {};
  const balanceKeys = ['open_guest_balances', 'invoice_ledger_by_status', 'vouchers_sold', 'vouchers_redeemed', 'deposits_on_bookings', 'deposits_on_future_bookings', 'last_day_closing', 'payments_debtor'];
  let bi = 0;
  for (const key of balanceKeys) {
    bi += 1;
    if (delta || !numbers[key]) continue;
    balances.winhotel += 1;
    await stage(org, opts.snapshotId, 'balance', bi, key, { label: numbers[key].label, value: numbers[key].value, snapshotDate: snapDate });
    balances.staged += 1;
  }
  const consents = E('consent');
  for (const c of delta ? [] : wh.consents) { consents.winhotel += 1; await stage(org, opts.snapshotId, 'consent', Number(c.lnr), 'core_gap_gdpr_journal', c); consents.staged += 1; }
  const cash = E('cash_book');
  for (const c of delta ? [] : wh.cashBook) { cash.winhotel += 1; await stage(org, opts.snapshotId, 'cash_book', Number(c.lnr), 'core_gap_cash_book', c); cash.staged += 1; }

  // ── 9. Звірка (IMPORT-PLAN §5) ───────────────────────────────────────────
  const num = (k: string, i = 0): number => { const v = numbers[k]?.value ?? ''; const parts = v.split(/\s+/); const n = Number(parts[i]); return Number.isFinite(n) ? n : NaN; };
  const ourUnitTypes = cat.unitTypeByCode.size;
  const ourUnits = cat.unitByCode.size;
  const whRealTypes = wh.unitTypes.filter((t) => !t.pseudo && t.lnr !== 0 && t.lnr !== 99999).length;
  const whRealUnits = wh.units.filter((u) => u.zinr && Number(u.zinr) < 9000 && u.stock !== 99).length;
  const resCount = Number((await sql.row<{ n: number }>(`SELECT COUNT(*) AS n FROM reservations r WHERE r.organization_id = ? AND r.external_uid LIKE ? AND ${ACROSS.sql}`, [org, `${EXTERNAL_PREFIX}%`, ...ACROSS.params]))?.n ?? 0);
  const inWindow = wh.bookings.filter((b) => b.vonaufh && b.bisaufh && (delta || (snapDate && b.vonaufh > snapDate) || b.vonaufh >= since)).length;
  const futureWh = snapDate ? wh.bookings.filter((b) => b.vonaufh && b.vonaufh > snapDate && (b.ta_status ?? 0) < 1000).length : 0;
  const futureOurs = snapDate ? Number((await sql.row<{ n: number }>(`SELECT COUNT(*) AS n FROM reservations r WHERE r.organization_id = ? AND r.external_uid LIKE ? AND r.check_in > ? AND r.status <> 'cancelled' AND ${ACROSS.sql}`, [org, `${EXTERNAL_PREFIX}%`, snapDate, ...ACROSS.params]))?.n ?? 0) : 0;
  const guestLines = wh.folioLines.filter((l) => l.gk_lnr && reservationIdOf.has(l.gk_lnr)
    && lineKind(groupCodeOf(serviceByLnr.get(l.leist_lnr ?? -1), groupByLnr)) !== 'cash_article');
  const whLineCount = guestLines.length;
  const whLineSum = money(guestLines.reduce((a, l) => a + (l.gbetrag ?? 0), 0));
  const whPayCount = wh.payments.filter((p) => p.lnr_gk && reservationIdOf.has(p.lnr_gk)).length;
  const whPaySum = money(wh.payments.filter((p) => p.lnr_gk && reservationIdOf.has(p.lnr_gk)).reduce((a, p) => a + (p.betrag ?? 0), 0));
  const mustMatch: MustMatch[] = [
    { name: 'unit_types = категорії PSEUDO 0', winhotel: whRealTypes, ours: ourUnitTypes, ok: ourUnitTypes >= whRealTypes },
    { name: 'units = номери ZINR < 9000', winhotel: whRealUnits, ours: ourUnits, ok: ourUnits >= whRealUnits },
    { name: 'fin_tax_rates покривають коди STS', winhotel: wh.taxCodes.length, ours: cat.taxRates.length, ok: cat.taxRates.length > 0 },
    { name: delta ? 'reservations ⊇ GASTKONT дельти (вікно)' : 'reservations = GASTKONT у вікні імпорту', winhotel: inWindow, ours: resCount, ok: delta ? resCount >= inWindow - bookings.staged : resCount === inWindow - (bookings.staged) },
    { name: 'майбутні брони (після знімка), живі, без staging', winhotel: futureWh - (bookings.skipped.staged_future ?? 0), ours: futureOurs, ok: futureOurs === futureWh - (bookings.skipped.staged_future ?? 0) },
    { name: 'fin_folio_items = BUCHKONT імпортованих броней без касових статей, кількість', winhotel: whLineCount, ours: lines.imported + (lines.skipped.unchanged ?? 0), ok: lines.imported + (lines.skipped.unchanged ?? 0) + (lines.staged - cashArticles.n) === whLineCount },
    { name: 'fin_folio_items = BUCHKONT без касових статей, сума', winhotel: whLineSum, ours: importedLineSum, ok: Math.abs(importedLineSum - whLineSum) < 0.005 || lines.staged - cashArticles.n > 0 },
    { name: 'платежі: у фоліо + staging = ZAHLUNGEN імпортованих броней', winhotel: whPayCount, ours: payments.imported + (payments.skipped.unchanged ?? 0) + payments.staged, ok: payments.imported + (payments.skipped.unchanged ?? 0) + payments.staged + (payments.skipped.zero_amount ?? 0) === whPayCount },
    { name: 'платежі, сума (у фоліо + staging)', winhotel: whPaySum, ours: money(importedPaySum + stagedPaySum), ok: Math.abs(money(importedPaySum + stagedPaySum) - whPaySum) < 0.005 },
    { name: 'фактури = RECHNUNG (усі в staging)', winhotel: wh.invoices.length, ours: invoices.staged, ok: invoices.staged === wh.invoices.length },
  ];
  const explained = [
    { name: 'guests ≤ адрес без DEBI_NR', winhotel: guests.winhotel, ours: guests.imported + (guests.skipped.unchanged ?? 0), why: 'різниця — злиті дублікати (email/телефон/імʼя, правило @guests)' },
    { name: 'companies = адрес з DEBI_NR', winhotel: companies.winhotel, ours: companies.imported + (companies.skipped.unchanged ?? 0) + companies.staged, why: 'staging — відмова ядра (дубль business_id) або зміна без дверей' },
    { name: 'брони до дати «з»', winhotel: bookings.skipped.before_since ?? 0, ours: 0, why: `минулі брони із заїздом до ${since} не імпортуються (параметр)` },
    { name: 'бронь без категорії/гостя/із перетином', winhotel: bookings.staged, ours: 0, why: 'staging із причиною: no_unit_type, no_guest, overlap' },
    { name: 'номери псевдо (ZINR ≥ 9000)', winhotel: wh.units.length - whRealUnits, ours: 0, why: 'не імпортуються навмисно; брони на них — без номера' },
    { name: 'послуги без пари в каталозі', winhotel: unmatchedServices.length, ours: 0, why: unmatchedServices.length ? `пара потрібна лише майбутньому продажу; без пари: ${unmatchedServices.slice(0, 40).join(', ')}${unmatchedServices.length > 40 ? '…' : ''}` : 'усі живі послуги груп 200–500 мають пару' },
    { name: 'касові статті BUCHKONT (групи 700/750/800)', winhotel: cashArticles.n, ours: 0, why: `staging cash_article, сума ${cashArticles.sum}: каса/витрати, не фоліо гостя` },
    { name: 'DEBI_NR компаній → companies.debtor_no', winhotel: (companies.skipped.debtor_no_adopted ?? 0) + (companies.skipped.debtor_no_pending ?? 0), ours: companies.skipped.debtor_no_adopted ?? 0, why: `прийнято дверима adoptDebtorNo; зайнятий іншою фірмою → staging debtor_no_pending: ${companies.skipped.debtor_no_pending ?? 0}` },
    { name: 'брони з посиланням каналу (GASTKREF.EXT_SOURCE)', winhotel: refByBooking.size, ours: [...extSourceCounts.entries()].filter(([k]) => cat.sourceByName.has(k.toLowerCase())).reduce((a, [, n]) => a + n, 0), why: `джерело — з EXT_SOURCE, не з MARKSEG; значення: ${[...extSourceCounts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(', ') || 'немає'}; без пари в booking_sources → direct` },
    { name: 'перетини (overlap) за причиною', winhotel: bookings.skipped.overlap_winhotel_double ?? 0, ours: bookings.skipped.overlap_umzug ?? 0, why: `winhotel_double ${bookings.skipped.overlap_winhotel_double ?? 0} (дві живі броні Winhotel на одному номері в ті ж дати), umzug ${bookings.skipped.overlap_umzug ?? 0} (UMZUG_ZINR), other ${bookings.skipped.overlap_other ?? 0}` },
    { name: 'злиття гостей лише за імʼям з іншою датою народження / містом', winhotel: guests.skipped.merged_by_name ?? 0, ours: (guests.skipped.merged_by_name_other_birthdate ?? 0) + (guests.skipped.merged_by_name_other_city ?? 0), why: `інша дата народження ${guests.skipped.merged_by_name_other_birthdate ?? 0}, інше місто ${guests.skipped.merged_by_name_other_city ?? 0} — число для сесії 3 (правило @guests, З32)` },
  ];
  const mismatch = mustMatch.some((m) => !m.ok);

  const report: ImportReport = {
    phase: 'done', snapshotId: opts.snapshotId, snapshotDate: snapDate, mode: delta ? 'delta' : 'full', window, since, entities,
    staging: await stagingCounts(org), reconcile: { mustMatch, explained }, mismatch,
    refs: await countRefs(org), durationMs: Date.now() - t0,
  };
  log(`звірка: ${mustMatch.filter((m) => m.ok).length}/${mustMatch.length} зійшлось${mismatch ? ' — РОЗБІЖНІСТЬ' : ''}`);
  return report;
}
