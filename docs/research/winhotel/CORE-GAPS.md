# Дірки ядра ALiSiO, які показала база Winhotel

Сесія 5, задача 3, 10.09.2026. Для кожного пункту: що є у Winhotel (таблиця, колонки,
зразок з `extract-out/`), що є в нас (`db/postgres/schema.sql`, `src/modules/**` —
файл:рядок на голові гілки), чого бракує — колонка / таблиця / правило / лише UI, і
оцінка **ядро / модуль / застосунок / не потрібно** за `docs/ARCHITECTURE.md` §2
(ядро — те, без чого готель не існує; модуль — ключ реєстру фіч §2.3, зокрема
юрисдикція §6.6; застосунок — окремий застосунок поза PMS, як `winhotel-import`).
Кожен пункт написаний так, щоб з нього вийшла задача іншій сесії.

Пункти 1–5 — дорожня карта 1.3; 6–14 — те, що побачено в базі понад неї.

## 1. Фірмові тарифи (тариф, видимий лише компанії)

**Winhotel.** `PREISCODE 3 Firmenpreise` — окремий прайс-код з власними рядками
`PREISLIST.MATCHC FA_SD/FA_DZD/FA_SK/FA_DZK` (+ `_PROFOL`), сезони `SAISSTAM 101/103
«Firma NS/HS»`, `LEIST_LNR 78 Logis Firmen`; ціни не є `0,9 × Standard` (SD: 80,10 проти
84×0,9 = 75,6) — це **окремий прайс**, не знижка. Корпоративні клієнти — ще й прайс-коди
8 і 10 (по одному на фірму, з `MATCHC FIRMA_B_DZD_1/2`). Прив'язка: `ADRESSEN.PR_CODE`
(прайс-код на адресі) + `ADRESSEN.RABATT` (%) + `GASTKONT.PR_CODE` (на броні).

**У нас.** `rate_plans` (`schema.sql:1656`): `is_hidden`, `pricing_type manual/derived`
з `based_on_rate_plan_id` + `adjustment_*` (Ц28) — тобто «Standard −10 %» як похідний
тариф уже є; `reservations.company_id` (`schema.sql:1821`, FK) і `lodging_discount_percent`
(§6.3.1 — знижка на броні «для гостей через фірму зі знижкою»). `price_rules`
(`schema.sql:1540`) умов «для компанії» не мають. Зв'язку **компанія → тариф** немає ніде.

**Бракує.** Таблиця `company_rate_plans (company_id, rate_plan_id, organization_id)`
або колонка `rate_plans.company_id` (один тариф — одна компанія; у Winhotel саме так:
прайс-код 8 = одна фірма) + правило в котируванні: бронь з `company_id` бачить приховані
тарифи цієї компанії, без — не бачить; на екрані броні — вибір тарифу фільтрується
платником; у каналі такі тарифи не публікуються (`is_hidden` уже це робить). Рішення
§6.3.1 «фірмовий ТАРИФ — це прайс для всіх, хто ним бронює» — правильне для випадку
«Firmenpreise», але для «прайс-код 8 = FIRMA_A» потрібна саме прив'язка.

**Оцінка:** ядро (тарифи й компанії — ядро). **Розмір:** таблиця + міграція + фільтр у
`quote`/`rate-plans.repo` + UI вибору на броні.

## 2. Дебітор: номер, `offener Betrag`, Sammelrechnung

**Winhotel.** `ADRESSEN.DEBI_NR` (10000–12599, DATEV-діапазон), `MANDANT.LFDDEBITOR`
(лічильник), `DEFAULT_DEBINR`; `ZAHLUNGEN.M_DEBITOR`/`MAHNS` (рівень нагадування)/
`DEBI_BEZ_BETR`; `ZAHLUNG_ZUS` (погашення); `AUSGBUCH` (книга вихідних рахунків:
`ADR_LNR`, `RECHNR`, `UMSATZ`, `DB_STATUS`); `RECHNUNGSDRUCK.M_DEBIRECHN`; `RECHNUNG.VERK_NR`
— **групова фактура на `Verkn-Nr`** (одна фактура на кілька рахунків гостей = Sammelrechnung);
`GET_OFFEN_ZAHLBETRAG` = послуги − платежі по рахунку; `DEVISEN.M_DEPITOR` — спосіб оплати
«на дебітора».

**У нас.** `fin_folios.payer_kind = 'company'`, `payer_debtor_no` (`schema.sql:825`) —
заповнюється з `companies.business_id` (`companies/api/kernel.ts:55`), тобто **номер
дебітора = IČO/реєстраційний номер**, окремої колонки немає; `companies`
(`schema.sql:490`) без `debtor_no`, без ліміту/умов оплати; `fin_folios.reservation_id`
— один (`folio.repo.ts:21`), тобто **фоліо однієї броні**; `invoices.folio_id` один →
одна фактура = один фоліо = одна бронь; `openGross` рахується на фоліо
(`folio.repo.ts:341`); `fin_channel_receivables` — борги OTA, не компаній; звіт
`reports.handlers.ts:131` рахує «очікувані платежі» з броней, не з фактур; `invoices`
без `paid_at`/`status = paid`; нагадувань (Mahnung) немає.

**Бракує.** (1) `companies.debtor_no` (число, унікальне на організацію, з лічильником
`organizations.next_debtor_no` і стартом з `MANDANT.LFDDEBITOR`) + `payment_terms_days`;
(2) **фоліо на кілька броней**: `fin_folio_items.reservation_id` уже на рядку — тобто
фоліо компанії з `reservation_id = NULL` і рядками різних броней технічно можливе, але
`ensureFolio`/`createFolio` шукають фоліо по `reservation_id` (`folio.repo.ts:36,93`) —
потрібен «фоліо платника» рівня компанії + перенесення рядків між фоліо різних броней
(зараз `folio.repo.ts:321` це забороняє); (3) `offener Betrag` по фактурі: `invoices`
+ `SUM(fin_folio_payments.amount WHERE invoice_id)` — читач є частково (`openGross`),
потрібен список «відкриті фактури компанії» і `due_date` з `payment_terms_days`;
(4) нагадування — рівень і дата (`MAHNS`) — модуль, не ядро.

**Оцінка:** (1)–(3) ядро; (4) модуль «дебіторка/нагадування». **Розмір:** дві колонки,
одна зміна семантики фоліо (велика: Sammelrechnung — це зміна інваріанта «фоліо ↔
бронь»), один екран «компанія → відкриті фактури».

## 3. `Zimmer FIX zugesagt` (номер гарантовано)

**Winhotel.** Колонка **не ідентифікована** — на `GASTKONT` кандидати `KONTINGENT
SMALLINT`, `STATUS1/STATUS2`, `TEMP_RES`; на екрані це прапорець. Агрегати покажуть,
яке поле міняється.

**У нас.** `reservations.unit_id` nullable + `idx_reservations_unassigned`
(`schema.sql:2853`) — «без номера» є; призначений номер — є; **«призначений і не
чіпати»** — немає: перетягування в шахматці (`calendar/drag.check.ts`) і будь-який
автопідбір можуть переселити.

**Бракує.** Колонка `reservations.unit_locked BOOLEAN DEFAULT FALSE` + правило: писачі,
що міняють `unit_id`, відмовляють, якщо `unit_locked` і не знято явно; шахматка показує
замок; підтвердження гостю друкує номер лише при `unit_locked`. Лише колонка + одна
перевірка в писачі + іконка.

**Оцінка:** ядро, малий. **Задача:** імпорт ставить `unit_locked` з поля, яке знайде
агрегат.

## 4. Три вікові групи (дорослий / підліток / дитина / немовля)

**Winhotel.** Чотири групи всюди: `ERW`/`JUG`/`KIND`/`KK` (Erwachsene, Jugendliche,
Kinder, Kleinkinder) — у `GASTKONT` (`PERSZAHL`, `ANZJUGEND`, `ANZKINDER`, `ANZKINDER2`,
`ANZKLEINKIND`), `SEGMSTAM` (ціни пансіону по групах), `SAISSTAM.SAIS_TXT_*`,
`PREISLIST_VERERB.AUFSCHLAG_ERW/JUG/K1..K4`, `KURTSTAM` (курортний збір `ERBETR/JUGBETR/
KINDBETR`), послуги `TAXEE/TAXEJ/TAXEK`; межі — `ADRESSEN_ALTER_KREIS` (3 рядки:
`VON_ALTER`–`BIS_ALTER`).

**У нас.** `organizations.child_age_bands` (`schema.sql:1422`, Ц30) — довільні вилки
дітей (`[3, 12]` → 0–2 / 3–11 / 12–17), дорослий від 18; `extra_occupancy_rules.
age_band_index` (`schema.sql:640`) — правило на вилку; `reservations.adults/children/
infants` — **три лічильники**, без віку дітей (Ц30: «вік у бронях поки не збирається»
→ `childAgesRequired`); `reservation_guests.date_of_birth` — є на гостя. Kurtaxe по
групах — `fees_taxes.applies_to` (ядро нейтральне §6.6).

**Бракує.** Не колонки, а **дані дітей на броні**: або `reservations.children_ages`
(JSON), або лічильник на вилку (`children_by_band`), щоб правила по вилках працювали
без `reservation_guests` (яких на момент броні ще немає). Winhotel тримає 4 лічильники
на броні — простіше й достатньо для 31 номера. Плюс імпорт `ANZJUGEND` → вилка 12–17,
`ANZKINDER` → 3–11, `ANZKLEINKIND` → `infants`.

**Оцінка:** ядро, малий (колонка + читач у `nightly-price.ts` замість `childAgesRequired`).

## 5. Знижка успадковує ПДВ (Rabatt на рядку з тією самою ставкою)

**Winhotel.** Знижка — **послуга з від'ємною сумою** і власним `STS`: `LEISTSTA 13
RABATT Nachlass/Rabatt Logis` (`STS 2`, 7 %, `KONTONR 4300`), `93 RABATT_19 Nachlass/
Rabatt 19%` (`STS 3`, `KONTONR 4790`), `75 NACHLASS ab 3 Nächte`, `76 NACHL_10`;
`PREISSPLITTING.PROZ_VOM_REDUZ_BETR`/`BRUTTO_NETTO` — знижка розкладається по
компонентах пакета пропорційно; `FAKT_ERLOESE.STEUERSATZ` — ставка на кожній проводці.
Тобто у Winhotel ставка знижки — **явний вибір послуги** (7 % або 19 %), і бухгалтер
бачить обидві.

**У нас.** `reservations.lodging_discount_percent` + `lodging_discount_reason`
(`schema.sql:1819`, §6.3.1) — лише на проживання, застосовується в `splitOtaAmount()`
**після** відділення сніданку (`stay-charges.repo.ts:196–231`), рядок називається
`Übernachtung (−10 %)` — тобто ставка успадковується від проживання за побудовою.
Знижки на послугу (19 %) немає; `price_rules` — до фоліо, на ціну ночі, ставку не
чіпають; `fin_folio_items.kind = 'manual'` — ручний рядок з будь-якою ставкою.

**Бракує.** Для проживання — нічого (зроблено правильно). Для **послуг** — знижка на
рядок фоліо, що успадковує `vat_rate` рядка (`fin_folio_items.discount_percent` або
окремий від'ємний рядок з `voided_by_item_id`-подібним зв'язком `discount_of_item_id`),
і на фактурі — рядок «Nachlass» зі ставкою батьківського рядка. Пакетна знижка
(`PREISSPLITTING.PROZ_VOM_REDUZ_BETR` — пропорційно по ставках) — лише якщо з'являться
пакети.

**Оцінка:** ядро (фактура), середній. Не блокує імпорт: історичні знижки приходять як
рядки з від'ємною сумою і своєю ставкою (`kind = 'manual'`, `source = 'import'`).

## 6. Журнал згод GDPR на гостя (`ADR_DATENSCHUTZ`)

**Winhotel.** `ADR_DATENSCHUTZ` (61 305): адреса × пункт `DATENSCHUTZSTAM` (3 пункти з
текстом, HTML, прив'язкою до Meldeschein) × коли/хто; `ADRESSEN.DS_VORGENOMMEN`,
`DS_VERSION`, `NEWSLETTER`; `GASTKSIGNO` — підпис гостя на планшеті. Згода — на
**особу**, не на перебування.

**У нас.** `guest_registrations.consent_given/consent_at/consent_ip` (`schema.sql:1222`)
— на **бронь**; `guests` без згод; ретенція `guests/domain/retention` — знеособлення за
терміном.

**Бракує.** `guest_consents (guest_id, consent_kind, version, given_at, source, revoked_at)`
+ довідник текстів згод з версією (`consent_texts`) — щоб «маркетинг: так» жило на
гостеві й переживало брони; `guests.newsletter` як похідне. Імпорт кладе 61 тис. рядків
сюди.

**Оцінка:** ядро (GDPR — усі юрисдикції), малий-середній.

## 7. Способи оплати як довідник готелю (`DEVISEN`)

**Winhotel.** `DEVISEN` (24): назва, `ZAHLUNGSART` (клас), `M_DEPITOR` (дебіторський),
`KONTONR` (рахунок обліку), `ZVT_AKTIV` (EC-термінал), `FISKAL_GES_VORF`, `KURS_FAKT`,
`AKTIVE_WEB`, `GASTAUSLAGE`.

**У нас.** `fin_folio_payments.method CHECK IN ('cash','card_terminal','transfer',
'voucher')` (`schema.sql:799`) — **чотири класи в CHECK**, без довідника; `finance_accounts`
— рахунки; рахунок обліку на спосіб оплати — немає.

**Бракує.** Довідник `payment_methods (organization_id, code, name, kind ∈ {cash, card,
transfer, voucher, debtor, online}, account_id, fiscal_relevant BOOLEAN, is_active)`;
`fin_folio_payments.method` лишається класом для TSE/DSFinV-K, додається
`payment_method_id`. Так готель розрізняє «EC-Karte», «Kreditkarte», «Überweisung
Firma», «Booking.com virtual card» — і бухгалтерія отримує рахунок. Імпорт мапить 24
рядки без втрат.

**Оцінка:** ядро, малий. Клас у CHECK лишається (KassenSichV питає клас).

## 8. Сегменти броні з ціновими наслідками (`SEGMSTAM`)

**Winhotel.** `SEGMSTAM` (10): код, назва, колір + **ціни пансіону за групами**
(`ERW_FRS/HP/VP`, `JUG_*`, `KIND_*`, `KK_*`, і `_S` — сезонні), `LEISTUNG_LNR`,
`PROZENT_BETRAG`. Сегмент = джерело + правило харчування.

**У нас.** `booking_sources` (`schema.sql:248`): код, назва, колір, `commission_percent`,
`city_tax_included_default` — джерело без цінових наслідків; харчування — `rate_plans.
meal_plan` і `extra_occupancy_rules.meal_*`.

**Бракує.** Нічого в ядрі: у нас це розкладено правильно (джерело — `booking_sources`,
ціна харчування — тариф/правило). Імпорт: `SEGMSTAM` → `booking_sources`, ціни пансіону
за сегментом — **не переносити** (наш тариф їх тримає). **Не потрібно.**

## 9. Денні закриття (`TAG_ABS`) і касова книга (`KASSEN`)

**Winhotel.** `TAG_ABS` (1 386): лічильник, сальдо, `SIGN_ABSCHLUSS_OK`; `KASSEN` (206):
касова книга поза рахунками (витрати, приватні, транзит) з `KONTONR`; `KASSVORTRAG` —
вхідне сальдо.

**У нас.** `fin_cash_closings` (`schema.sql:709`): один на об'єкт на день, каса/карта
окремо, лічильники TSE — **є**; `fin_operations` — витрати/доходи поза бронями — є.

**Бракує.** Вхідне сальдо каси (`opening_balance`) на `fin_cash_closings` або на
організації — для першого закриття після імпорту; решта — **не потрібно**.

**Оцінка:** ядро, тривіально.

## 10. Пропозиції (`ANGEBOT`) як окрема сутність до броні

**Winhotel.** `ANGEBOT` (693) + `ANG_LEISTUNG` (783): пропозиція на адресу з датами,
особами, рядками, `AKTIV`, `STO_GRUND`; бронь посилається `GASTKONT.ANG_LNR`.

**У нас.** `reservations.status = 'draft'`/`'tentative'`, `booking_drafts` (віджет),
`site_incoming_leads`; пропозиція з рядками цін, яку гість підтверджує, — це
`tentative` + лист «пропозиція» (§2.6 три листи).

**Бракує.** Нічого в схемі; для імпорту `ANGEBOT` без броні → `reservations.status =
'tentative'` з `internal_notes`, або не переносити (693 за 20 років). **Не потрібно.**

## 11. Гість: злиття дублікатів, newsletter, ID документів супутників

**Winhotel.** 37 тис. адрес; `SUCHNAME`, `MATCHCODE`, `GASTNR` (старий номер), `LFD_HIST`;
`NEWSLETTER`; `ID_NR_BEGL`, `ID_NR_K1..K5` (документи супутника й дітей на адресі).

**У нас.** `guests` (`schema.sql:1238`) без `external_ref`, без злиття, без
`marketing_opt_in`; `reservation_guests.document_*` — є на особу перебування.

**Бракує.** (1) **Злиття гостей** (`mergeGuests(keepId, dropId)`: перенести
`reservations.guest_id`, `reservation_guests.guest_id`, `guest_registrations`, зберегти
`dropId` у `merged_into`) — потрібно й без імпорту, дублікати роблять портьє; (2)
`guests.marketing_opt_in` (з п. 6 як похідне); (3) `guests.external_ref` (п. 12).

**Оцінка:** (1) ядро, середній; (2) з п. 6; (3) з п. 12.

## 12. Зовнішній ключ походження на кожній імпортованій сутності

**Winhotel → нас.** Імпорт має бути повторюваним (свіжий знімок) і звірюваним
(`IMPORT-PLAN.md` §5). Для цього кожен рядок ALiSiO, що прийшов з Winhotel, мусить
знати свій `LNR`.

**У нас.** `reservations.external_uid` (зайнятий каналом/Hostex), `import_entity_mappings`
(`schema.sql`, є таблиця мапи імпорту з Блоку імпорту Booking-Excel — перевірити її
форму: `import_run_id`, `entity`, `external_id`, `internal_id`) — **саме вона** і є
місцем; `guests`/`companies`/`invoices`/`fin_folio_items`/`fin_folio_payments` без поля.

**Бракує.** Підтвердити, що `import_entity_mappings` покриває всі 10 сутностей плану
(entity ∈ {unit_type, unit, rate_plan, season, service, company, guest, reservation,
folio_item, invoice, payment}) і має UNIQUE на (`organization_id`, `entity`,
`external_id`); якщо так — колонки не потрібні. Плюс правило: імпорт пише повз
фіскальну варту `fiscal_de` (історичні готівкові платежі — копії, не оплати) і повз
`@channels/outbox` (історичні брони не їдуть у канал; майбутні — їдуть один раз після
імпорту як повна публікація).

**Оцінка:** застосунок `winhotel-import` + два правила в ядрі (варта і outbox мають
знати про `source = 'import'`). Малий.

## 13. Історичні фактури з чужою нумерацією й чужим TSE

**Winhotel.** `RECHNUNG.RECHNR` 1…~33 тис. з префіксом `MANDANT.RECHNR_VORSPANN`;
підписи fiskaltrust у `FISKAL_RECHNUNG`; `RECHNUNG.SIGN_NICHT_OK`.

**У нас.** `invoice_series` (`schema.sql:1313`): кілька серій з префіксом і форматом —
серія `WH` для legacy розв'язує колізію номерів; `invoices.locked/confirmed`; `tse_*` на
платежах — порожні для legacy (це чужа TSE); `fin_fiscal_outages` — не для цього.

**Бракує.** Позначка «документ виставлений іншою системою» — `invoices.origin_system`
(або `is_custom`/`series = 'WH'` як маркер) + у друці legacy-фактури: не друкувати наш
TSE-блок і не перегенеровувати PDF, а віддавати збережений (у Winhotel PDF немає —
`RECHNUNGSDRUCK` це рядки; отже друкуємо наш бланк з написом «Kopie aus Vorsystem»).
GoBD: копія має бути відтворювана — рядки заморожені, це вже так.

**Оцінка:** ядро (invoicing), малий; юрисдикційна частина (напис, TSE-блок) — модуль
`fiscal_de`.

## 14. Що в базі є, а нам не потрібно (свідомо)

`PLZ_ORT`/`PLZ_STRASSE` (довідник адрес Німеччини — автодоповнення: не потрібно,
є зовнішні API), `ANWENDER_PROT`/`USERPROT` (аудит — у нас `platform_audit`/
`booking_activity_log`), `STAT_*`/`TEMP_*` (похідне), `ONLINETRANS_ALLE` (журнал каналу —
у нас `cm_outbox`/`cm_events`), `WEB_ABF_*` (сесії веб-модуля — у нас `widget_events`),
`TEXTE`/`VORLAGEN` (шаблони листів — у нас три листи §2.6, шаблони не імпортуються),
`FREIMELD_*` (channel manager — Channex), `HOUSEKEEPING`/`TISCH*`/`KURS*`/`EIGT_*`/
`REGKAS_*`/`TELEFON*`/`MITARB*` (порожні модулі), `ATRUST_*` (Австрія), `DOKUMENT` (17 542
листів-BLOB — за рішенням власника: або не переносити, або як файли до броні
`reservation_files`).

## Підсумок для контролера — п'ять найбільших дірок

1. **Sammelrechnung / дебітор** (п. 2) — фоліо прив'язане до однієї броні; групова
   фактура компанії за кілька перебувань і «відкриті фактури компанії» неможливі.
2. **Фірмовий тариф ↔ компанія** (п. 1) — приховані тарифи є, зв'язку з компанією немає.
3. **Злиття гостей** (п. 11) — без нього імпорт 37 тис. адрес дасть 37 тис. гостей.
4. **Довідник способів оплати з рахунком обліку** (п. 7) — чотири класи в CHECK замість
   24 способів готелю.
5. **Згоди GDPR на гостя** (п. 6) — згода живе на броні, а не на особі; 61 тис. рядків
   Winhotel нема куди покласти.
