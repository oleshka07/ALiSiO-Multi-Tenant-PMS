/**
 * Згоди Winhotel → наші таблиці: відображення поле в поле (INC-302, крок 14).
 *
 * ── Що тут вирішується ──────────────────────────────────────────────────
 *
 * `ADR_DATENSCHUTZ` — адреса × пункт згоди × коли. Наші `guest_consents`
 * вимагають ще й ВЕРСІЮ тексту, бо згода без версії не доводить нічого. У
 * Winhotel версія лежить не там, де очікувалось:
 *
 *   DATENSCHUTZSTAM   пункт згоди: BEZEICHN, BEZ_ZUSATZ_HTML, SPRACHE_LNR
 *                     — і ЖОДНОЇ колонки версії (перевірено по DDL бази);
 *   ADRESSEN.DS_VERSION  редакція, яку бачила ЦЯ людина;
 *   ADR_DATENSCHUTZ   ні версії, ні тексту — лише посилання й час.
 *
 * Отже версія береться з АДРЕСИ, а не з пункту й не з рядка згоди. І звідси
 * головне правило цього файла.
 *
 * ── Нічого не вгадується. Три роди карантину ────────────────────────────
 *
 * Winhotel зберігає лише НИНІШНІЙ текст трьох пунктів. Людина, чия
 * `DS_VERSION` інша, підписувала текст, якого в базі немає — і поставити їй
 * нинішній означало б підпис під документом, якого вона не бачила. Тому:
 *
 *   `unknown_kind`         пункт не названо людиною → не вгадуємо, що
 *                          «Newsletter» це маркетинг: назва пункту залежить
 *                          від мови й від готелю;
 *   `no_version`           адреса не знає своєї редакції (NULL/0);
 *   `text_not_in_database` редакція не та, яку описують нинішні тексти.
 *
 * Карантин — не втрата: рядок їде у звіт імпорту, і рішення ухвалює людина.
 * Мовчазне «нехай буде версія 1» — саме те, чого тут не буде.
 *
 * ── Чому мапи приходять ЗЗОВНІ ──────────────────────────────────────────
 *
 * `kindOfType` і `localeOfSprache` не зашиті: у базі немає нічого, з чого їх
 * можна вивести без здогаду. Їх називає людина, подивившись на три рядки
 * довідника, — і саме тому пункт, якого в мапі немає, потрапляє в карантин, а
 * не дістає значення за замовчуванням (інваріант 8).
 */

/** Рядок `DATENSCHUTZSTAM` — пункт згоди. */
export interface WinhotelConsentType {
  lnr: number;
  bezeichn: string;
  bez_zusatz_html?: string | null;
  sprache_lnr?: number | null;
}

/** Рядок `ADR_DATENSCHUTZ` — хто, на що і коли погодився. */
export interface WinhotelConsentRow {
  lnr: number;
  adr_lnr: number;
  datenschutzstam_lnr: number;
  erf_datumzeit: string;
}

export interface ConsentImportInput {
  types: WinhotelConsentType[];
  consents: WinhotelConsentRow[];
  /** `ADRESSEN.LNR` → `ADRESSEN.DS_VERSION`. Редакція живе на АДРЕСІ. */
  versionOfAddress: Map<number, number | null>;
  /** `DATENSCHUTZSTAM.LNR` → наш `consent_kind`. Називає людина. */
  kindOfType: Map<number, string>;
  /** `SPRACHE_LNR` → мова тексту. Називає людина. */
  localeOfSprache: Map<number, string>;
  /** Яку редакцію описують НИНІШНІ тексти довідника. Називає людина. */
  currentVersion: number;
}

export interface PlannedText {
  externalRef: string;
  consentKind: string;
  version: string;
  locale: string;
  body: string;
}

export interface PlannedConsent {
  externalRef: string;
  /** Ключ походження ГОСТЯ — той самий, що ляже в `guests.external_ref`. */
  guestExternalRef: string;
  consentKind: string;
  version: string;
  givenAt: string;
  source: 'import';
}

export type QuarantineReason = 'unknown_kind' | 'no_version' | 'text_not_in_database';

export interface QuarantinedConsent {
  externalRef: string;
  reason: QuarantineReason;
  /** Речення для звіту оператора — його читає людина, а не код. */
  says: string;
}

export interface ConsentImportPlan {
  texts: PlannedText[];
  consents: PlannedConsent[];
  quarantined: QuarantinedConsent[];
}

/** Ключ походження: система, таблиця, ідентифікатор у ній (INC-301). */
export const winhotelRef = (table: string, id: number) => `winhotel:${table}:${id}`;

export function planConsentImport(input: ConsentImportInput): ConsentImportPlan {
  const version = String(input.currentVersion);
  const texts: PlannedText[] = [];

  for (const type of input.types) {
    const kind = input.kindOfType.get(type.lnr);
    if (!kind) continue;   // пункт не названо — його згоди підуть у карантин нижче
    const locale = input.localeOfSprache.get(type.sprache_lnr ?? -1);
    if (!locale) continue; // мову не названо — те саме
    texts.push({
      externalRef: winhotelRef('datenschutzstam', type.lnr),
      consentKind: kind,
      version,
      locale,
      // Повний текст — заголовок плюс HTML-пояснення: у Winhotel це два поля
      // одного документа, і показувати наглядачеві половину не можна.
      body: [type.bezeichn, type.bez_zusatz_html].filter(Boolean).join('\n\n'),
    });
  }

  const consents: PlannedConsent[] = [];
  const quarantined: QuarantinedConsent[] = [];

  for (const row of input.consents) {
    const ref = winhotelRef('adr_datenschutz', row.lnr);
    const kind = input.kindOfType.get(row.datenschutzstam_lnr);
    if (!kind) {
      quarantined.push({ externalRef: ref, reason: 'unknown_kind',
        says: `Пункт ${row.datenschutzstam_lnr} не названо: невідомо, на що погодилась людина` });
      continue;
    }
    const ds = input.versionOfAddress.get(row.adr_lnr);
    if (ds == null || ds === 0) {
      quarantined.push({ externalRef: ref, reason: 'no_version',
        says: `Адреса ${row.adr_lnr} не знає редакції: невідомо, який текст бачила людина` });
      continue;
    }
    if (ds !== input.currentVersion) {
      quarantined.push({ externalRef: ref, reason: 'text_not_in_database',
        says: `Редакція ${ds} у базі відсутня (довідник описує ${input.currentVersion}): `
          + 'підставити нинішній текст означало б підпис під документом, якого людина не бачила' });
      continue;
    }
    consents.push({
      externalRef: ref,
      guestExternalRef: winhotelRef('adressen', row.adr_lnr),
      consentKind: kind,
      version,
      givenAt: row.erf_datumzeit,
      source: 'import',
    });
  }

  return { texts, consents, quarantined };
}
