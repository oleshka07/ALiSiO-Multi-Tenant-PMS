/**
 * Чисті перетворення рядків Winhotel у слова ядра — без бази.
 *
 * Джерела: `docs/research/winhotel/IMPORT-PLAN.md` §2 (правила по сутностях),
 * `MAPPING.md` (колонки), `CORE-GAPS.md` (чого ядро не вміє). Кожна мапа тут
 * — гіпотеза дослідження, звірена на агрегатах першого знімка
 * (`booking_status_mix` у `aggregates-2025-03.json`): те, що агрегат не
 * підтверджує, іде в staging, а не в ядро.
 */

// ── Рядки, як їх віддає міст (apps/winhotel-import/sql/*.sql) ────────────

export interface WhUnitType { lnr: number; kategorie: string | null; bemerk1: string | null; pseudo: boolean | null; anz_erw: number | null; anz_k1: number | null }
export interface WhUnit { lnr: number; zinr: string | null; lnr_kate: number | null; stock: number | null; gesperrt: boolean | null }
export interface WhService { lnr: number; kurzbez: string | null; bezeichn: string | null; wg: number | null; sts: number | null; betrag: number | null; ta_status: number | null }
export interface WhTaxCode { lnr: number; sts: number | null; stsatz: number | null; von: string | null; bis: string | null }
export interface WhSegment { lnr: number; segmcode: number | null; bezeichn: string | null }
/** WARENGRUPPE: `lnr` — те, на що посилається `LEISTSTA.WG`; `wgnr` — КОД групи (100…800). */
export interface WhServiceGroup { lnr: number; wgnr: number | null; bezeichn: string | null; durchl: boolean | null }
/** GASTKREF: посилання каналу на бронь — `ext_source` («Booking.com», «DIRS21»…) і його номер. */
export interface WhBookingRef { lnr: number; gk_lnr: number | null; ref_nr: string | null; inet_ref_nr: string | null; ext_source: string | null; ext_refnr: string | null }
export interface WhPaymentMethod { lnr: number; kurzbez: string | null; bezeichn: string | null; zahlungsart: number | null; m_depitor: boolean | null; ta_status: number | null }
export interface WhAddress {
  lnr: number; adr_wahl: number | null; anrede: string | null; titel: string | null; name1: string | null; name2: string | null;
  strasse: string | null; land: string | null; plz: string | null; ort: string | null; sprache: number | null;
  tele1: string | null; e_mail: string | null; gebdat: string | null; geschlecht: string | null; id_nr: string | null;
  st_angeh: string | null; newsletter: boolean | null; suchname: string | null; debi_nr: number | null;
  steuernummer: string | null; pr_code: number | null; rabatt: number | null;
  begleit: string | null; begleit_v: string | null; begleit_g: string | null; id_nr_begl: string | null;
  k1: string | null; k1_nname: string | null; k1_geb: string | null; k2: string | null; k2_nname: string | null; k2_geb: string | null;
  k3: string | null; k3_nname: string | null; k3_geb: string | null; k4: string | null; k4_nname: string | null; k4_geb: string | null;
  k5: string | null; k5_nname: string | null; k5_geb: string | null;
  bemerk: string | null; bemerk2: string | null; wunsch_zi: string | null;
}
export interface WhBooking {
  lnr: number; vonaufh: string | null; bisaufh: string | null; auftage: number | null; lnr_kate: number | null; lnr_zinr: number | null;
  resv_kate_lnr: number | null; umzug_zinr: string | null; gastnr_1: number | null; gastnr_2: number | null; gastnr_3: number | null;
  perszahl: number | null; anzkinder: number | null; anzkinder2: number | null; anzkleinkind: number | null; anzjugend: number | null;
  begleitok: boolean | null; kind1ok: boolean | null; kind2ok: boolean | null; kind3ok: boolean | null; kind4ok: boolean | null; kind5ok: boolean | null;
  buch_status: number | null; ci_status: number | null; ta_status: number | null; storno_datum: string | null; verk_nr: number | null;
  pr_code: number | null; markseg: number | null; anza_betrag: number | null; anza_datum: string | null;
  bestellt_durch: string | null; bemerk: string | null; notiz: string | null; erf_datum: string | null; kor_datum: string | null;
}
export interface WhFolioLine {
  lnr: number; gk_lnr: number | null; leist_lnr: number | null; von: string | null; bis: string | null; tage: number | null; me: number | null;
  bezeichn: string | null; gbetrag: number | null; tagbetrag: number | null; e_preis: number | null; rechnr: number | null;
  sto_kennung: number | null; umb_gk_lnr: number | null;
}
export interface WhPayment {
  lnr: number; budat: string | null; uhrzeit: string | null; lnr_devi: number | null; bezeichn: string | null; betrag: number | null;
  gastnr_1: number | null; lnr_gk: number | null; re_nr: number | null; m_debitor: number | null;
}
export interface WhInvoice { lnr: number; rechnr: number | null; rechnr_alpha: string | null; gk_lnr: number | null; datum_zeit: string | null; ta_status: number | null; storno_kz: number | null; verk_nr: number | null }
export interface WhInvoiceLine { lnr: number; rechnr: number | null; gk_lnr: number | null; bk_lnr: number | null; m_debirechn: boolean | null; gbetrag: number | null }
export interface WhLedger { lnr: number; rechnr: number | null; adr_lnr: number | null; umsatz: number | null; db_status: number | null }

// ── Стан броні (IMPORT-PLAN §2.8, гіпотеза; агрегат 2025-03 її підтверджує) ─
//
// booking_status_mix на живому знімку: (BUCH 0, CI 2, TA 500) ×20 897 — виїхали
// й виставлені; (0,0,1001)/(0,0,1000)/(0,0,1500) — видалені/сторновані;
// (0,0,0) ×926 — чинні до заїзду; (100,0,*) — Option/Angebot; (0,1,*) — в домі.
export type CoreStatus = 'tentative' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show';

/**
 * Незатирання (задача 8 §3): імпорт пише стан лише ВПЕРЕД — `tentative →
 * confirmed → checked_in → checked_out`. Кіоск заселив, а нічний знімок ще
 * каже CI_STATUS 0 — стан лишається `checked_in`. `cancelled` — лише з
 * TA_STATUS (тут) або відсутності в повному знімку (імпортер); і назад із
 * `cancelled` — лише коли Winhotel сам зняв сторно (TA_STATUS < 1000).
 */
const STATUS_RANK: Record<string, number> = { tentative: 0, confirmed: 1, checked_in: 2, checked_out: 3 };

export function statusForward(current: string | null | undefined, incoming: CoreStatus): CoreStatus {
  if (incoming === 'cancelled') return 'cancelled';
  if (!current || current === 'cancelled' || !(current in STATUS_RANK)) return incoming;
  return STATUS_RANK[incoming] >= STATUS_RANK[current] ? incoming : (current as CoreStatus);
}

export function bookingStatus(b: Pick<WhBooking, 'buch_status' | 'ci_status' | 'ta_status' | 'storno_datum'>): CoreStatus {
  if ((b.ta_status ?? 0) >= 1000) return 'cancelled';
  if (b.ci_status === 2) return 'checked_out';
  if (b.ci_status === 1) return 'checked_in';
  if (b.buch_status === 100) return 'tentative';
  return 'confirmed';
}

// ── Спосіб оплати (DEVISEN → чотири класи; решта — staging) ─────────────

export type CoreMethod = 'cash' | 'card_terminal' | 'transfer' | 'voucher';

export function paymentMethod(m: Pick<WhPaymentMethod, 'kurzbez' | 'bezeichn' | 'm_depitor'>): CoreMethod | null {
  const text = `${m.kurzbez ?? ''} ${m.bezeichn ?? ''}`.toLowerCase();
  if (/gutschein|voucher/.test(text)) return 'voucher';
  if (/\bbar\b|cash|kasse|bargeld/.test(text)) return 'cash';
  if (/\bec\b|karte|card|visa|master|amex|maestro|kredit|girocard|zvt|terminal/.test(text)) return 'card_terminal';
  if (m.m_depitor || /debitor|überweis|ueberweis|bank|rechnung|transfer|vorkasse|paypal|online|unzer/.test(text)) return 'transfer';
  return null;
}

// ── Ставка ПДВ: STS — код, не число (MAPPING п. 11) ─────────────────────

export type CoreTaxCode = 'standard' | 'reduced' | 'zero';

export function taxCode(sts: number | null | undefined): CoreTaxCode | null {
  if (sts === 1) return 'zero';
  if (sts === 2) return 'reduced';
  if (sts === 3) return 'standard';
  return null;
}

// ── Рід рядка рахунку за товарною групою послуги (IMPORT-PLAN §2.4, §2.9) ──
//
// `LEISTSTA.WG` — це LNR рядка WARENGRUPPE, а не код групи: живі значення
// `wg` ∈ {1…9}, коди — `service_groups.wgnr` ∈ {100…800} (рецензія Б, п. 1).
// Тому рід питається ЛИШЕ за кодом, отриманим джойном `wg → lnr → wgnr`; число
// групи без цього джойна тут не приймається (`groupCodeOf`), і фікстура
// тримає `wg ≠ wgnr` (інваріант 26).

export type LineKind = 'lodging' | 'service' | 'city_tax';
/** Касова стаття (700 Geldtransit, 750 Ausgaben, 800 Kein Umsatz) — не рядок фоліо гостя. */
export type LineRoute = LineKind | 'cash_article';

/** Код групи послуги через WARENGRUPPE.LNR; групи немає — null (рід тоді `service`). */
export function groupCodeOf(service: Pick<WhService, 'wg'> | undefined, groups: Map<number, WhServiceGroup>): number | null {
  const g = service?.wg != null ? groups.get(service.wg) : undefined;
  return g?.wgnr ?? null;
}

const LODGING_WORDS = /logis|übernachtung|uebernachtung/i;

export function lineKind(groupCode: number | null, groupName?: string | null): LineRoute {
  if (groupCode === 100 || (groupCode === null && groupName && LODGING_WORDS.test(groupName))) return 'lodging';
  if (groupCode === 600) return 'city_tax';
  if (groupCode !== null && groupCode >= 700) return 'cash_article';
  return 'service';
}

/**
 * Послуга, для якої шукається пара в каталозі готелю: жива, і не з груп
 * 100/600/700/750/800 (логіс, збори, каса). Пара потрібна лише для майбутнього
 * продажу, не для перенесеної історії, тому її відсутність — не відмова, а
 * рядок у `reconcile.explained` (рецензія Б, п. 3).
 */
export function needsCatalogMatch(s: WhService, groupCode: number | null): boolean {
  if ((s.ta_status ?? 0) >= 1000) return false;
  if (groupCode === 100 || (groupCode !== null && groupCode >= 600)) return false;
  return !!s.bezeichn;
}

/** Назва послуги для звірки: регістр, пробіли, `-`/`–`/`—` і пробіли навколо них — одне. */
export function normalizeServiceName(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Люди ────────────────────────────────────────────────────────────────

/** Дві літери країни з коду Winhotel (`D`, `A`, `CH`…); невідоме — null. */
export function countryCode(land: string | null | undefined): string | null {
  const v = (land ?? '').trim().toUpperCase();
  if (!v) return null;
  const map: Record<string, string> = { D: 'DE', A: 'AT', CH: 'CH', NL: 'NL', B: 'BE', F: 'FR', I: 'IT', PL: 'PL', CZ: 'CZ', DK: 'DK', S: 'SE', N: 'NO', GB: 'GB', UK: 'GB', L: 'LU', E: 'ES', P: 'PT', H: 'HU', UA: 'UA', USA: 'US', US: 'US' };
  if (map[v]) return map[v];
  return /^[A-Z]{2}$/.test(v) ? v : null;
}

export function gender(g: string | null | undefined, anrede: string | null | undefined): 'female' | 'male' | null {
  const v = (g ?? '').trim().toUpperCase();
  if (v === 'W' || v === 'F') return 'female';
  if (v === 'M') return 'male';
  const a = (anrede ?? '').toLowerCase();
  if (/frau|mrs|ms|paní|пані/.test(a)) return 'female';
  if (/herr|mr\b|pan\b|пан\b/.test(a)) return 'male';
  return null;
}

export function language(sprache: number | null | undefined): string | null {
  // 1 — німецька (зразки), 2 — англійська; решта невідома, тож не вгадуємо.
  if (sprache === 1) return 'de';
  if (sprache === 2) return 'en';
  return null;
}

/**
 * Компанія — це `ADR_WAHL = 1` («Firma» в ADRESSEN_ART). `DEBI_NR` ознакою не є:
 * Winhotel дає дебіторський номер кожному, хто отримував рахунок, — на живому
 * 15 421 приватних осіб із 17 461 (рецензія Б, п. 2).
 */
export function isCompany(a: Pick<WhAddress, 'adr_wahl'>): boolean {
  return a.adr_wahl === 1;
}

/** Ім'я гостя: NAME1 — прізвище або фірма, NAME2 — імʼя (MAPPING п. 2). */
export function guestName(a: Pick<WhAddress, 'name1' | 'name2'>): { firstName: string; lastName: string } {
  const lastName = (a.name1 ?? '').trim() || '—';
  const firstName = (a.name2 ?? '').trim();
  return { firstName, lastName };
}

export interface Companion { slot: number; firstName: string; lastName: string; dateOfBirth: string | null; documentNumber: string | null }

/** Супутник і до пʼяти дітей однієї адреси — рядки `reservation_guests`, коли бронь їх називає. */
export function household(a: WhAddress, flags: { begleit: boolean; kids: boolean[] }): Companion[] {
  const out: Companion[] = [];
  if (flags.begleit && a.begleit) {
    out.push({ slot: 10, firstName: (a.begleit_v ?? '').trim(), lastName: a.begleit.trim(), dateOfBirth: a.begleit_g, documentNumber: a.id_nr_begl });
  }
  const kids: Array<[string | null, string | null, string | null]> = [
    [a.k1, a.k1_nname, a.k1_geb], [a.k2, a.k2_nname, a.k2_geb], [a.k3, a.k3_nname, a.k3_geb], [a.k4, a.k4_nname, a.k4_geb], [a.k5, a.k5_nname, a.k5_geb],
  ];
  kids.forEach(([first, last, geb], i) => {
    if (!flags.kids[i] || !first) return;
    out.push({ slot: 11 + i, firstName: first.trim(), lastName: (last ?? a.name1 ?? '').trim(), dateOfBirth: geb, documentNumber: null });
  });
  return out;
}

/** Кількість у рядку: ME × TAGE, якщо це дає суму; інакше один рядок на всю суму. */
export function lineQuantity(l: Pick<WhFolioLine, 'me' | 'tage' | 'e_preis' | 'gbetrag'>): { quantity: number; unitPrice: number } {
  const me = l.me && l.me > 0 ? l.me : 1;
  const tage = l.tage && l.tage > 0 ? l.tage : 1;
  const total = l.gbetrag ?? 0;
  const unit = l.e_preis ?? 0;
  const qty = me * tage;
  if (unit !== 0 && Math.abs(unit * qty - total) < 0.005) return { quantity: qty, unitPrice: unit };
  if (unit !== 0 && Math.abs(unit * me - total) < 0.005) return { quantity: me, unitPrice: unit };
  return { quantity: 1, unitPrice: total };
}

export function nightsOf(b: Pick<WhBooking, 'vonaufh' | 'bisaufh' | 'auftage'>): number {
  if (b.auftage && b.auftage > 0) return b.auftage;
  if (b.vonaufh && b.bisaufh) {
    const n = Math.round((Date.parse(b.bisaufh) - Date.parse(b.vonaufh)) / 86_400_000);
    if (n > 0) return n;
  }
  return 1;
}

export function internalNotes(b: Pick<WhBooking, 'bestellt_durch' | 'bemerk' | 'notiz'>): string | null {
  const parts = [b.bestellt_durch && `Bestellt durch: ${b.bestellt_durch}`, b.bemerk, b.notiz].filter(Boolean) as string[];
  return parts.length ? parts.join('\n') : null;
}

export const EXTERNAL_PREFIX = 'winhotel:GASTKONT:';
