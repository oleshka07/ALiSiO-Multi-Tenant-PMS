/**
 * 1 344 живі згоди Winhotel мають КУДИ лягти — і жодна не вигадується (INC-302).
 *
 *   node src/modules/guests/domain/consent-import.check.ts
 *
 * ── Числа тут справжні, і два з них виправляють задачу ──────────────────
 *
 * `ADR_DATENSCHUTZ` має 61 305 рядків — це число цитують і CORE-GAPS п. 6, і
 * задача, і шапка міграції 0300. Але імпорт бере лише живі
 * (`TA_STATUS < 1000`, `apps/winhotel-import/sql/consents.sql`), а їх за
 * виміром моста **1 344** (`aggregates-2025-03.json`, `entities.consents`).
 * Тобто 98 % рядків — видалені/архівні. Так само адрес: 37 088 сирих проти
 * **34 795** живих.
 *
 * Обсяг це змінює на два порядки, форму — ні: таблиці потрібні ті самі. Але
 * «61 тисяча згод» і «1 344 згоди на 34 795 людей» — різні твердження про
 * готель, і друге означає, що згоду має ~4 % адрес.
 *
 * ── Де лежить версія: не там, де очікувалось ────────────────────────────
 *
 * За DDL справжньої бази `DATENSCHUTZSTAM` НЕ МАЄ колонки версії взагалі;
 * `DS_VERSION` лежить на `ADRESSEN`. Тобто редакцію знає людина, а не пункт
 * згоди — і мапа мусить брати її звідти.
 *
 * ── Що доводиться ───────────────────────────────────────────────────────
 *
 * Пари, а не лише відмови (§26): на кожен рід карантину — рядок, який
 * ПРОХОДИТЬ, інакше твердження зелене й на мапі, яка карантинить усе.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { planConsentImport, winhotelRef } = await import('./consent-import.ts');

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

// Рядки довідника — зі справжнього витягу (`fixture/extracted/consent_types.jsonl`),
// імена колонок — із DDL справжньої бази.
const types = [
  { lnr: 1, bezeichn: 'Newsletter', bez_zusatz_html: '<p>Wir senden Angebote.</p>', sprache_lnr: 1 },
  { lnr: 2, bezeichn: 'Speicherung der Daten', bez_zusatz_html: null, sprache_lnr: 1 },
  // Третій пункт у справжній базі Є (DATENSCHUTZSTAM = 3 рядки), але у витягу
  // його немає — тож його назви ми не знаємо. Саме такий випадок і мусить
  // впертись у карантин, а не дістати значення за замовчуванням.
  { lnr: 3, bezeichn: 'Unbekannter Punkt', bez_zusatz_html: null, sprache_lnr: 1 },
];

const consents = [
  { lnr: 1, adr_lnr: 1, datenschutzstam_lnr: 1, erf_datumzeit: '2025-01-01 10:00:00' },
  { lnr: 2, adr_lnr: 1, datenschutzstam_lnr: 2, erf_datumzeit: '2025-01-01 10:00:00' },
  { lnr: 3, adr_lnr: 2, datenschutzstam_lnr: 3, erf_datumzeit: '2024-03-03 09:00:00' },
  { lnr: 4, adr_lnr: 3, datenschutzstam_lnr: 1, erf_datumzeit: '2020-06-06 08:00:00' },
  { lnr: 5, adr_lnr: 4, datenschutzstam_lnr: 1, erf_datumzeit: '2019-01-01 08:00:00' },
];

const plan = planConsentImport({
  types,
  consents,
  // `ADRESSEN.DS_VERSION` — зі справжніх рядків витягу: адреси 1 і 2 мають 2,
  // адреса 3 має 0 (фірма), адреса 4 — стара редакція 1.
  versionOfAddress: new Map([[1, 2], [2, 2], [3, 0], [4, 1]]),
  kindOfType: new Map([[1, 'marketing'], [2, 'data_processing']]),   // третій НЕ названо
  localeOfSprache: new Map([[1, 'de']]),
  currentVersion: 2,
});

// ── Тексти ──────────────────────────────────────────────────────────────────
say(plan.texts.length === 2,
  `у довідник лягли лише НАЗВАНІ пункти — 2 з 3 (${plan.texts.length})`);
const newsletter = plan.texts.find((t) => t.consentKind === 'marketing');
say(newsletter?.version === '2' && newsletter?.locale === 'de',
  'текст знає СВОЮ редакцію і мову: версія 2, локаль de');
say(newsletter?.body.includes('Newsletter') && newsletter?.body.includes('Angebote'),
  'у тексті і заголовок, і HTML-пояснення — половини документа наглядачеві не показують');

// ── Згоди, які проходять ────────────────────────────────────────────────────
say(plan.consents.length === 2, `пройшли 2 згоди (${plan.consents.length})`);
say(plan.consents.every((c) => c.version === '2' && c.source === 'import'),
  'кожна згода несе редакцію, яку бачила людина, і каже, що прийшла з імпорту');
say(plan.consents[0]?.guestExternalRef === winhotelRef('adressen', 1),
  'згода знає ключ походження СВОГО гостя — той самий, що ляже в guests.external_ref');

// ── Карантин: три роди, кожен своїм рядком ──────────────────────────────────
const why = (r: string) => plan.quarantined.filter((q) => q.reason === r).length;
say(why('unknown_kind') === 1,
  'пункт, якого людина не назвала, — у карантин, а не «нехай буде маркетинг»');
say(why('no_version') === 1,
  'адреса без редакції — у карантин: невідомо, який текст бачила людина');
say(why('text_not_in_database') === 1,
  'стара редакція, тексту якої в базі немає, — у карантин, а не під нинішній документ');
say(plan.quarantined.length === 3 && plan.consents.length + plan.quarantined.length === consents.length,
  'жоден рядок не загубився: 2 пройшли + 3 у карантині = 5 вхідних');
say(plan.quarantined.every((q) => q.says.length > 20),
  'кожен карантин пояснено реченням для людини, а не кодом');

assert.deepStrictEqual(fails, [], `не виконано: ${fails.join('; ')}`);
console.log('consent-import: згоди лягають з редакцією, яку бачила людина; решта — у карантин, і нічого не вигадано');
