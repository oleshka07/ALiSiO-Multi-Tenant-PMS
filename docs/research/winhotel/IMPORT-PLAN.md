# План імпорту Winhotel.MX → ALiSiO для застосунку `winhotel-import`

Сесія 5, задача 3, 10.09.2026. Це не код і не схема — інструкція тому, хто писатиме
застосунок. Джерела: `MAPPING.md` (таблиці й колонки), `TABLES.md` (обсяги),
`COUNTS-2025-03.md` (звірка), `extract-out/main/DDL.sql` (FK, тригери, процедури),
наша схема `db/postgres/schema.sql` і `docs/ARCHITECTURE.md` §6. Знімок 11.03.2025 —
структура; перед перенесенням буде свіжий.

## 0. Три речі, які визначають увесь план

1. **Winhotel не видаляє — він позначає.** `TA_STATUS >= 1000` = видалено/сторновано;
   кожен `SELECT` імпортера має `TA_STATUS < 1000`, крім тих, де ми свідомо переносимо
   історію сторно (фактури зі `STORNO_KZ`, рядки з `STO_KENNUNG`).
2. **Зовнішніх ключів у базі шість.** Решта зв'язків — за іменами; імпортер не може
   покластися на цілісність і мусить рахувати сироти на кожному кроці й звітувати
   їх, а не падати. Список місць, де сироти вже були в самого вендора, — його ж
   процедури `TOOL_ABGL_*` (`notes.md` §7).
3. **Одна адреса = домогосподарство, один рахунок гостя = бронь.** Це не наша модель
   (у нас гість — особа, бронь — номер на період, фоліо — платник), тож імпорт не
   «копіює таблиці», а **розкладає**: `ADRESSEN` → `guests` + `companies` +
   `reservation_guests`; `GASTKONT` → `reservations` + `fin_folios`; `BUCHKONT` →
   `fin_folio_items` (+ звірка з нашим `priceNights()`), `RECHNUNG` → `invoices` як
   заморожені копії.

## 1. Порядок сутностей і чому такий

| # | Крок | Winhotel → ALiSiO | Залежить від | Обсяг (03.2025) |
|---|---|---|---|---|
| 1 | Об'єкт | `MANDANT` → `properties` (уже заведений через `provision-org`/`apply-hotel`; імпорт лише звіряє назву/адресу) | — | 1 |
| 2 | Ставки ПДВ | `STEUSTAM` → `fin_tax_rates` (`standard`/`reduced`/`zero` з `valid_from`/`valid_to`) | 1 | 7 |
| 3 | Категорії й номери | `KATESTAM` → `unit_types`; `ZIMMSTAM` → `units` | 1 | 7 + 31 |
| 4 | Послуги | `LEISTSTA` (+ `WARENGRU`) → каталог послуг (`additional_services`/`service_addons` з `vat_code`) | 2 | 132 → ~40 живих |
| 5 | Тарифи й ціни | `PREISCODE` → `rate_plans`; `SAISSTAM` → `seasons`; `PREISLIST` → `season_prices` + `price_occupancy`; `MIN_TAGE` → `price_los_tiers`; Aufbettung → `extra_occupancy_rules` | 3 | 10 / 23 / 341 |
| 6 | Джерела/сегменти | `SEGMSTAM` → `booking_sources` | 1 | 10 |
| 7 | Адреси: компанії | `ADRESSEN` з `DEBI_NR > 0` (або тип «фірма» з `ADR_AUSWAHL`) → `companies` | 1 | ~2,6 тис. (діапазон 10000–12599) |
| 8 | Адреси: гості | решта `ADRESSEN` → `guests` (з дедуплікацією) | 1 | ≤ 37 088 |
| 9 | Брони | `GASTKONT` (+ `BELEGUNG` для переселень, `GASTKREF` для референсів) → `reservations` (+ `reservation_sub_bookings` по `VERK_NR`) + `reservation_guests` (`GASTNR_2/3`, супутник, діти) | 3, 5, 6, 7, 8 | 52 941 |
| 10 | Рядки рахунків | `BUCHKONT` → `fin_folios` (один на бронь; другий `payer_kind = company`, якщо є `M_DEBIRECHN`) + `fin_folio_items` | 4, 9 | 195 303 |
| 11 | Фактури | `RECHNUNG` + `RECHNUNGSDRUCK` → `invoices` + `fin_invoice_lines` + перерахована `fin_invoice_tax_totals`; `AUSGBUCH` → `company_id`/дебітор на фактурі | 7, 10 | 33 059 |
| 12 | Оплати | `ZAHLUNGEN` (через `DEVISEN`) → `fin_folio_payments`; `KASSEN` → касові операції `fin_operations` без броні | 10, 11 | 26 115 + 206 |
| 13 | Сальдо | ваучери, депозити, відкриті дебіторські — числа, не рядки (§3) | 10–12 | — |
| 14 | GDPR | `ADR_DATENSCHUTZ` → `guest_registrations.consent_*` (по броні) або окремий журнал (див. `CORE-GAPS.md`) | 8, 9 | 61 305 |

Чому так: за FK Winhotel `BELEGUNG`/`BUCHKONT` вимагають `GASTKONT`, `PREISSPLITTING` —
`PREISLIST`; за нашою схемою `reservations` вимагає `guest_id`, `property_id`,
`unit_type_id`, `rate_plan_id`, `source`; `fin_folio_items` — `folio_id`; `invoices` —
`folio_id`/`reservation_id`; `fin_folio_payments` — `folio_id`. Довідники — першими, бо
все нижче посилається на них, і бо їх можна перевірити очима за годину до того, як
поїдуть 200 тис. рядків.

**Ідемпотентність.** Кожен рядок ALiSiO, створений імпортом, несе `external_ref`
(`winhotel:<TABLE>:<LNR>`) — у `reservations.external_uid`, у решти таблиць — поле
`external_ref`/`notes`, якого поки **немає** (див. `CORE-GAPS.md` п. 12). Повторний
прогін на свіжому знімку — upsert по цьому ключу, а не дубль.

## 2. Правила перетворення — по сутностях

### 2.1 Спільні

| Що | Правило |
|---|---|
| Ключ | `winhotel:<TABLE>:<LNR>` → `external_ref`; `MAND_NR = 1` (перевірити, що другий мандант порожній) |
| Живий/видалений | `TA_STATUS < 1000` — живий; `>= 1000` — не імпортувати, крім фактур зі `STORNO_KZ` (стають `invoices.status = 'storno'`) |
| Суми | `BIGINT / 1000` → `NUMERIC(14,2)` через `money()` (інваріант 9); `NUMERIC(12,3)` домени — так само |
| Текст | байти → `windows-1252` → UTF-8; перевірити на першому прізвищі з умлаутом |
| Дати | `DATE`/`TIMESTAMP` як є; `1899-12-30` і будь-що `< 1900-01-01` → `NULL`; `2050-12-31` у `BIS` довідників = «без кінця» → `NULL` |
| Прапорці | Winhotel `SMALLINT 0/1` (і `-1` = true у `ZIMMERART`) → `BOOLEAN`; писати `TRUE`/`FALSE` (інваріант 12) |
| Орендар | кожен `INSERT` називає `organization_id` явно; імпорт іде під `runWithOrganization` одного готелю |

### 2.2 Ставки ПДВ → `fin_tax_rates`

`STS 1` → `zero`, `2` → `reduced`, `3` → `standard`; `STSATZ` → `rate`; `VON`/`BIS` →
`valid_from`/`valid_to`. 7 рядків, з історією 2020 (5 %/16 %) — переносити всі: старі
фактури не читають довідник (інваріант 18), але звіти за 2020 — так.

### 2.3 Категорії й номери

- `KATESTAM WHERE PSEUDO = 0 AND LNR NOT IN (0, 99999)` → `unit_types`: `KATEGORIE` →
  `code`, `BEMERK1` → `name`, `ANZ_ERW` → `max_adults`, `ANZ_K1` → `max_children`,
  `ANZ_BETTEN`… → `max_occupancy` = `ANZ_ERW` (V: 4), `base_occupancy` = 2 (з цін: ÜF_2
  — базова), `extra_bed_available` = чи є `ÜF_3/4` у `PREISLIST`.
- `ZIMMSTAM WHERE CAST(ZINR AS INTEGER) < 9000 AND TA_STATUS < 1000` → `units`: `ZINR` →
  `code` і `name`, `STOCK` → `floor`, `LNR_KATE` → `unit_type_id`, `GESPERRT = 1` →
  `room_status = 'blocked'`.
- **Псевдо-номери** (`PSEUDO = 1` / `ZINR >= 9000` / `STOCK = 99` — на цих даних збігаються):
  `9001 SEM` → `event_spaces` (зала; брони на ньому → `event_bookings`, не `reservations`);
  `9500–9502`, `9999 PS` — **не імпортувати як `units`**; брони з `LNR_ZINR` на них →
  `reservations.unit_id = NULL` (у нас «без призначеного номера» — це і є
  `idx_reservations_unassigned`), `unit_type_id` — з `LNR_KATE`/`RESV_KATE_LNR`.
  Брони на `9999` з `TA_STATUS >= 1000` — сторно з channel manager, пропускаються.

### 2.4 Послуги → каталог послуг

`LEISTSTA WHERE TA_STATUS < 1000` → `additional_services`: `BEZEICHN` → назва,
`BETRAG/1000` → ціна, `STS` → `vat_code` (`reduced`/`standard`/`zero`), `WG` → наша
класифікація (`WARENGRU 100` → `lodging`, 200/300 → `service` їжа/напої, 600 →
`city_tax`/durchlaufend, 700/750/800 → не послуга, а касова операція). Логіс-послуги
(`1`, `67`, `78`, `114`) не імпортуються як послуги — вони стають `kind = 'lodging'`
рядків фоліо. Вимкнені (`TA_STATUS 1000`, ресторанні групи) — не переносити, але тримати
мапу `LEIST_LNR → kind` для історичних рядків `BUCHKONT`.

### 2.5 Тарифи й ціни

- `PREISCODE WHERE TA_STATUS < 1000` → `rate_plans`: 1 Standard (`code = 'STD'`,
  `pricing_type = 'manual'`, `sell_mode = 'per_person'` — бо ÜF_1..4 різні ціни),
  3 Firmenpreise → окремий `manual` тариф (`FA_* ≠ 0,9 × ÜF`, див. `MAPPING.md` п. 8),
  4 Booking.com / 5 HRS / 9 WEB.MX — канальні тарифи (ціна там `0` з `FM_RATEID` → у нас
  ціна приходить із каналу, тариф лише мапиться в `cm_mappings`), 7 Wanderreisen — тариф
  партнера, 8 корпоративний — тариф компанії (`CORE-GAPS.md` п. 1).
- `SAISSTAM WHERE TA_STATUS < 1000 AND VON >= <рік знімка − 1>` → `seasons` (обидві межі
  включно; сезони без перетину — писач відмовить на 701–705 одноденних тестових: їх
  пропустити).
- `PREISLIST` (живі, чинний сезон, `PRCODE_LNR` тарифу): `BETRAG/1000` → `season_prices`
  (сезон × `unit_type` × тариф) для `MATCHC = ÜF_2` (базова заселеність); `ÜF_1/3/4` →
  `price_occupancy` (`persons` = 1/3/4, `valid_from/to` = сезон) — вісь **дорослих**
  (Ц12); `MIN_TAGE > 0` → `price_los_tiers`; `EZPREIS`/`EZZUSCHLAG` → `price_occupancy`
  для 1 особи, якщо `ÜF_1` немає.
- `LEISTSTA 68 Aufbettung 19,00` → `extra_occupancy_rules` (`guest_kind = 'adult'`,
  `lodging_mode = 'fixed'`, `lodging_value = 19`, `extra_bed = TRUE`); дитячі — з
  `SEGMSTAM.KIND_*`/`PREISLIST_VERERB.AUFSCHLAG_K*` як `guest_kind = 'child'` по вилках
  (`organizations.child_age_bands` треба задати з `ADRESSEN_ALTER_KREIS`).
- `PREISSPLITTING` → перевірка, а не дані: наш `splitOtaAmount()` має дати той самий
  Logis/сніданок-спліт, що й `PREISSPLITTING` для `ÜF`; розбіжність — у звіт імпорту.
- **Календар не імпортується** — `season_prices` рендерить `price_calendar` сам
  (§6.2, Ц27). Ціни на минулі дати не потрібні: історичні брони несуть свої суми.

### 2.6 Компанії → `companies`

`ADRESSEN WHERE DEBI_NR > 0 AND TA_STATUS < 1000` (плюс `ADR_WAHL` = тип «фірма» без
`DEBI_NR` — на прогоні порахувати, чи є такі): `NAME1` → `name`, `NAME2` →
`notes`/контактна особа, `STEUERNUMMER` → `vat_id` (перевірити формат: `USt-IdNr` чи
`Steuernummer`), адреса → `address_*`, `E_MAIL`, `TELE1`; `DEBI_NR` → **`companies.debtor_no`
(немає — `CORE-GAPS.md` п. 2)**, тимчасово `business_id`; `PR_CODE` → зв'язок
компанія → тариф (`CORE-GAPS.md` п. 1); `RABATT` → там само; банк/картка — **не
переносити** (у нас `iban`/`bic` на компанії є, але це реквізити для оплати НАМ, а не
дані картки клієнта).

### 2.7 Гості → `guests`, дедуплікація

`ADRESSEN` без `DEBI_NR`, `TA_STATUS < 1000`: `NAME1` → `last_name`, `NAME2` →
`first_name`, `ANREDE`/`GESCHLECHT` → `gender`, `GEBDAT` → `date_of_birth`, `STRASSE`+
`PLZ`+`ORT`+`LAND` → `address`/`city`/`country`, `E_MAIL`, `TELE1` → `phone`, `SPRACHE`
→ `language`, `ST_ANGEH` → `nationality`, `ID_NR`/`ID_NR_AUSGESTELLT` → `document_*`,
`BEMERK`/`BEMERK2`/`WUNSCH_ZI` → `notes`, `NEWSLETTER` → (немає поля — `notes` або
`CORE-GAPS.md` п. 11).

**Супутник і діти.** `BEGLEIT`/`BEGLEIT_V`/`BEGLEIT_G`/`ID_NR_BEGL` і `K1..K5` (+ `_GEB`,
`_NNAME`, `ID_NR_K*`) — **не окремі `guests`**, а `reservation_guests` на тих бронях, де
`GASTKONT.BEGLEITOK`/`KIND1OK..KIND5OK = 1` (прапорці «супутник/дитина N їде»). Дитина
без броні з прапорцем — не переноситься (немає перебування — немає Meldeschein).

**Дублікати.** 37 тис. адрес на 31 номер — багато повторів. Правило злиття, у порядку:
1) однаковий `E_MAIL` (не порожній) → один гість; 2) `UPPER(SUCHNAME)` + `PLZ` + `GEBDAT`
(усі три не порожні) → один гість; 3) `UPPER(NAME1)` + `UPPER(NAME2)` + `PLZ` без дати
народження → **сумнівний** — імпортувати окремо, покласти в звіт «можливі дублікати» з
парою `LNR`, злиття — рукою на екрані гостя (у нас злиття гостей немає — `CORE-GAPS.md`
п. 11). Ніколи не зливати за самим прізвищем. Усі `LNR` злитих адрес — у `external_ref`
списком, бо брони посилаються на кожен.

### 2.8 Брони → `reservations`

Джерело — `GASTKONT WHERE TA_STATUS < 1000` (плюс `>= 1000` зі `STORNO_DATUM` → `status =
'cancelled'`, якщо готель хоче історію відмов; за замовчуванням — ні).

| Winhotel | ALiSiO | Примітка |
|---|---|---|
| `LNR` | `external_uid = 'winhotel:GASTKONT:<LNR>'` | `Beleg-Nr` |
| `VERK_NR` ≠ `LNR` | `parent_id` = бронь з `LNR = VERK_NR` (або `reservation_sub_bookings`) | група `Verkn-Nr` |
| `VONAUFH`/`BISAUFH` | `check_in`/`check_out`, `nights = AUFTAGE` | не з `BELEGUNG` |
| `LNR_KATE` (`RESV_KATE_LNR`, якщо ≠) | `unit_type_id` | заброньована категорія має пріоритет над фактичною |
| `LNR_ZINR` (< 9000) | `unit_id`; переселення з `BELEGUNG` (кілька рядків на `LNR_GK`) → `unit_id` останнього, історія в `internal_notes` | псевдо → `NULL` |
| `GASTNR_1` | `guest_id` (через мапу злиття) | замовник |
| `GASTNR_2`, `GASTNR_3` | `reservation_guests` (з `guest_id`) | гість/платник — порядок звірити на прогоні через `PROC_GET_GK3_ADR` |
| `PERSZAHL`, `ANZKINDER` (+`ANZKINDER2`), `ANZKLEINKIND` | `adults`, `children`, `infants` | `ANZJUGEND` → у `children` (у нас підлітки — вилка дітей) |
| `MARKSEG` → `SEGMSTAM.SEGMCODE` | `source` (код `booking_sources`) | 10 сегментів |
| `PR_CODE` | `rate_plan_id` | 0/NULL → Standard |
| `ANZA_BETRAG`/`ANZA_DATUM` | `deposit_amount`, `deposit_status = 'paid'` + `deposit_paid_at` | якщо є платіж `LEIST 114` |
| `BUCH_STATUS`, `CI_STATUS`, `TA_STATUS` | `status` — **гіпотеза з літералів процедур, звірити агрегатами**: `CI_STATUS 2` → `checked_out`; `1` → `checked_in`; `0` і `BUCH_STATUS 0` → `confirmed`; `0` і `BUCH_STATUS 100` → `tentative` (Option/Angebot); `ANG_LNR > 0` без `BUCH_STATUS 100` → `confirmed` з приміткою «з пропозиції»; `TA_STATUS >= 1000` + `STORNO_DATUM` → `cancelled`; `LEIST 12 NOSHOW` у рядках → `no_show` | Gastbestätigung/Reservierung з екрана — обидва `confirmed`, різниця в `TEXTE`, не в стані |
| `GASTKREF.REF_NR`/`EXT_REFNR`, `ONLINE_BUCHUNGEN.BUCHNR` | `hostex_reservation_code`-подібне поле — у нас `external_uid` уже зайнятий нашим ключем → `notes` або `CORE-GAPS.md` п. 12 | номер Booking.com |
| `BESTELLT_DURCH`, `NOTIZ`, `BEMERK` | `internal_notes` | |
| `REISEZWECK`, `NACHRICHT_ERWUENSCHT`, `GREENOPTIONS` | `reservation_guests.purpose_of_stay`; решта — `internal_notes` | |
| `KONTINGENT`/`STATUS1`/`STATUS2` | — | кандидати на `Zimmer FIX`; після агрегатів |
| `total_price` | `SUM(BUCHKONT.GBETRAG)/1000` по рахунку | контрольна сума; `priceNights()` НЕ переоцінює історичні брони |

### 2.9 Рядки рахунків → `fin_folios`, `fin_folio_items`

- Один `fin_folios` (`payer_kind = 'guest'`, `guest_id = GASTNR_1`) на бронь; другий
  (`payer_kind = 'company'`, `payer_debtor_no = DEBI_NR`) — якщо на броні є рядки з
  `RECHNUNGSDRUCK.M_DEBIRECHN = 1` або `AUSGBUCH.ADR_LNR` — фірма.
- `BUCHKONT WHERE TA_STATUS < 1000 AND GK_LNR = <бронь>` → `fin_folio_items`:
  `VON` → `service_date` (рядок з `TAGE > 1` розгортається **по одному рядку на ніч** для
  логіс і щоденних послуг — так у нас `nightly`; або лишається один з `quantity = ME ×
  TAGE` — вирішити за тим, чи фактура готелю показувала по днях: `RECHNUNGSDRUCK` має
  `VON`–`BIS`–`TAGE` в одному рядку → **один рядок з `quantity`**, `service_date = VON`),
  `LEIST_LNR` → `kind` (`lodging`/`service`/`city_tax`), `BEZEICHN` → `description`,
  `ME` → `quantity`, `E_PREIS/1000` → `unit_price_gross`, `GBETRAG/1000` → `total_gross`,
  ставка → `vat_rate` **числом** з `STEUSTAM` за `VON` і `LEISTSTA.STS` (не з
  `FAKT_ERLOESE`, якщо його немає для рядка), `source = 'import'`, `invoice_id` — якщо
  `RECHNR > 0` (після кроку 11).
- `STO_KENNUNG > 0` → рядок + `voided_by_item_id` на компенсуючий; `UMB_GK_LNR` →
  рядок належить фоліо іншої броні (переніс) — імпортувати туди.
- **Звірка з `priceNights()`** для живих майбутніх броней (33 на 2026): ціна за ніч з
  наших відновлених тарифів проти `TAGBETRAG/1000` — розбіжність у звіт, брони лишаються
  з імпортованими сумами (інваріант 17: ми не вигадуємо ціну, ми несемо ту, яку готель
  назвав).

### 2.10 Фактури → `invoices`

`RECHNUNG` (усі, і сторно): `RECHNR` → `invoice_number` (з `RECHNR_ALPHA`/`MANDANT.
RECHNR_VORSPANN`, серія `invoice_series` «WH-legacy», щоб не зіткнутись з нашою
нумерацією), `DATUM_ZEIT` → `issued_at`, `GK_LNR` → `reservation_id`/`folio_id`,
`STORNO_KZ > 0` → `status = 'storno'`, `LNR_CO` → `confirmed = TRUE`, `locked = TRUE`;
`amount` = `SUM(RECHNUNGSDRUCK.GBETRAG)/1000`. Рядки — `RECHNUNGSDRUCK WHERE RECHNR = …`
→ `fin_invoice_lines` (`GASTNAME` → `guest_name`, `ZINR` → `unit_code`, `VON` →
`service_date`, `ME` → `quantity`, `EBETRAG` → `unit_price_gross`, `GBETRAG` →
`total_gross`, ставка — за `LEIST_LNR` і датою → `vat_rate`, `net_amount`/`tax_amount`
перераховані). `fin_invoice_tax_totals` — **перерахувати від груп** (§6.1: від груп, не
від суми рядків). Одержувач: `AUSGBUCH.ADR_LNR` → `company_id`/`custom_buyer_*` або
`GASTKONT.GASTNR_n` за `BELGEIT_ALS_RE_EMPF`; `RE_NACHDRUCK` — адреса на момент друку,
якщо є. `invoice_counters` нашої серії стартують з 1; legacy-серія не продовжується.

### 2.11 Оплати → `fin_folio_payments`

`ZAHLUNGEN WHERE TA_STATUS < 1000`: `BETRAG/1000` → `amount` (зі знаком — повернення
мінусом), `BUDAT + UHRZEIT` → `paid_at`, `LNR_GK` → `folio_id` (гостьовий або фірмовий за
`M_DEBITOR`), `RE_NR` → `invoice_id`, `LNR_DEVI → DEVISEN` → `method`: мапа з 24 рядків
`DEVISEN` на `cash`/`card_terminal`/`transfer`/`voucher` — **скласти на прогоні** (зразка
немає), дебіторські (`M_DEPITOR = 1`) → `transfer` з `payer_kind = company`. `tse_*` —
**порожні**: підписи fiskaltrust не переносяться. Історичні готівкові платежі до
`fiscal_de` — імпорт іде повз фіскальну варту (вона на ЖИВИХ оплатах; імпорт — не оплата,
а копія; це треба сказати в коді явно, `CORE-GAPS.md` п. 12).
`KASSEN` → `fin_operations` (витрати/приватні/транзит) з `KONTONR` → рахунок.

### 2.12 Кроки після даних

- `organizations.child_age_bands` з `ADRESSEN_ALTER_KREIS` (3 рядки: межі вилок).
- `booking_sources.commission_percent` — з `ADRESSEN.PROV_PROZ` турагентів, якщо є.
- Політики скасування — **руками** з `TEXTE`/AGB (`MAPPING.md` п. 9) на `rate_plans.
  cancellation_policy`.
- Ваучери — руками з паперового реєстру; імпорт дає лише сальдо (§3).

## 3. Що імпортується сальдо, а не історією

| Що | Чому не історією | Число з Winhotel (SQL) | Куди в ALiSiO |
|---|---|---|---|
| **Ваучери** | реєстру немає (`GUTSCHEINE` 0); продаж — рядок послуги, погашення — спосіб оплати; номера ваучера в базі немає | продано: `SELECT SUM(GBETRAG)/1000 FROM BUCHKONT WHERE TA_STATUS<1000 AND LEIST_LNR IN (7,55,95)`; погашено: `SELECT SUM(Z.BETRAG)/1000 FROM ZAHLUNGEN Z JOIN DEVISEN D ON D.LNR=Z.LNR_DEVI WHERE Z.TA_STATUS<1000 AND UPPER(D.BEZEICHN) LIKE '%GUTSCHEIN%'`; сальдо = різниця | один рядок `gift_cards` «перенесене сальдо Winhotel» на суму, або по одному на кожен паперовий ваучер, який готель назве; звірити з сальдо |
| **Відкриті дебіторські** | `AUSGBUCH` — книга по фактурах, стан оплати `DB_STATUS` (розшифрувати); наш `invoices.status` не має «сплачено», борг рахується з платежів | по рахунку гостя: `EXECUTE BLOCK` над `GET_OFFEN_ZAHLBETRAG(LNR)` для `CI_STATUS = 2` (у `extract.sh`); по фактурах: `SELECT ADR_LNR, RECHNR, SUM(UMSATZ)/1000 FROM AUSGBUCH WHERE DB_STATUS = <не сплачено> GROUP BY 1,2` | фактури з кроку 11 без платежів на суму → вони і є відкритими; список звірити з `AUSGBUCH` один в один; окремий «дебіторський баланс компанії» — `CORE-GAPS.md` п. 2 |
| **Депозити** | `ANZA_BETRAG` на броні + послуга 114 + платіж — три записи про одне | `SELECT COUNT(*), SUM(ANZA_BETRAG)/1000 FROM GASTKONT WHERE TA_STATUS<1000 AND ANZA_BETRAG>0 AND VONAUFH > <знімок>` | `reservations.deposit_amount`/`deposit_status` на майбутніх бронях; платіж — як `fin_folio_payments` з `paid_at = ANZA_DATUM` |
| **Каса на дату** | `TAG_ABS` — денні закриття; `KASSVORTRAG` — вхідне сальдо | `SELECT SALDO/1000 FROM TAG_ABS ORDER BY TAG_ABS_DATUM DESC ROWS 1` | `fin_cash_closings` — лише останнє закриття як стартове; попередні 1 386 — не переносити |

## 4. Два способи доставки даних

### (а) Готель кладе `gbak`-бекап, ALiSiO відновлює й імпортує

Готель уже робить `gbak` щодня (є `WINHOTEL.fbk` на Drive). Оператор завантажує `.fbk`
у ALiSiO (форма «Імпорт з Winhotel» або тека SFTP); сервер у **окремому контейнері** з
`firebird3.0-utils` робить `gbak -c` (embedded, без сервера, без пароля — перевірено
10.09), читає через `isql`/драйвер Firebird (Node: `node-firebird`), пише в Postgres,
видаляє базу.

| | |
|---|---|
| Свіжість | на момент бекапу; для «перерізу» — бекап за годину до вимкнення Winhotel, імпорт, старт ALiSiO. Дельта-імпорт можливий (`external_ref` + `KOR_DATUM`), але не потрібен: переріз одноразовий |
| Що ставити в готелі | нічого: `gbak` у них є |
| Ризик для їхньої бази | нуль — читаємо копію |
| Обсяг коду | контейнер з Firebird (Dockerfile ~20 рядків), обробник завантаження, сам імпортер. Шлях **перевірений**: `extract.sh` — це той самий ланцюжок без запису в Postgres |
| Мінус | 400–600 МБ через браузер/SFTP; повторити при потребі — знову руками готелю |

### (б) Агент на сервері готелю читає `WINHOTEL.FDB` напряму

Windows-служба з Firebird-клієнтом (`fbclient.dll`), читає через локальний Firebird
Server (`localhost:3050`, потрібен логін SYSDBA або окремий користувач), шле рядки в API
ALiSiO.

| | |
|---|---|
| Свіжість | будь-яка, аж до синхронізації в реальному часі (можна працювати паралельно з Winhotel тижнями) |
| Що ставити в готелі | службу на сервері Winhotel (доступ до машини, обліковий запис, антивірус, оновлення), відкритий порт або тунель назовні |
| Ризик для їхньої бази | читання по мережі через сервер Winhotel: навантаження на їхній Firebird у робочий час; помилка агента з правами SYSDBA — ризик запису. ODS 12 — сумісний з клієнтом 3.x, але версію їхнього сервера ми не бачили (тільки ODS файлу) |
| Обсяг коду | агент (Windows, установник, оновлення, тунель, автентифікація) + приймальний API + той самий імпортер. Два-три рази більше за (а), і половина — не наш стек |
| Плюс | паралельний період «обидві системи»; свіжі ціни/брони без участі готелю |

### Рекомендація сесії — (а)

Переріз одноразовий, готель на 31 номер, бекап у них уже є. (а) не вимагає ставити
нічого на чужий сервер, не торкається їхньої живої бази, і ланцюжок уже пройдений
10.09 на справжніх 407 МБ. Паралельний період, який дає (б), не вартий агента: за день
до переходу беремо свіжий бекап і за годину переливаємо; репетицію (сухий прогін на
старому бекапі зі звіркою §5) робимо скільки завгодно разів заздалегідь. Якщо власник
захоче місяць «обидві системи» — тоді (б), але це інша задача. **Рішення — власника.**

## 5. Звірка після імпорту

Джерело чисел — `aggregates.txt` свіжого знімка (крок 7 `extract.sh`) і
`COUNTS-<дата>.md`.

| Число | Має зійтись | Пояснена різниця |
|---|---|---|
| `unit_types` = категорії `PSEUDO = 0` | **1:1** (7) | — |
| `units` = номери `ZINR < 9000`, живі | **1:1** (31) | псевдо 5 — не імпортовані навмисно |
| `fin_tax_rates` = `STEUSTAM` | **1:1** (7) | — |
| `rate_plans` = `PREISCODE` живі | 1:1 | канальні тарифи без цін — присутні, але порожні |
| `companies` = адреси з `DEBI_NR` живі | **1:1** | фірми без `DEBI_NR` — у звіт |
| `guests` | ≤ адрес живих без `DEBI_NR` | різниця = злиті дублікати; список пар у звіті імпорту; сумнівні — не злиті |
| `reservations` = `GASTKONT` живі | **1:1** | брони на `9001 SEM` → `event_bookings`; сторновані — лише якщо готель просив |
| `reservation_guests` | ≥ броней з `GASTNR_2/3` + супутники/діти з прапорцями | — |
| `fin_folio_items` = `BUCHKONT` живі | **1:1** по кількості **і** `SUM(total_gross)` = `SUM(GBETRAG)/1000` до цента | рядки з `UMB_GK_LNR` — на іншому фоліо, але в сумі |
| `invoices` = `RECHNUNG` | **1:1**, `MAX(invoice_number)` = `MAX(RECHNR)` | сторно — зі `status = storno`, у сумі не рахуються |
| `fin_invoice_lines` = `RECHNUNGSDRUCK` | 1:1 по кількості; сума по фактурі = `SUM(GBETRAG)` | — |
| `fin_folio_payments` = `ZAHLUNGEN` живі | **1:1**, сума до цента | повернення — мінусом, не менше рядків |
| Відкриті борги | сума по фоліо без платежів = сума `GET_OFFEN_ZAHLBETRAG` | по-фактурно = `AUSGBUCH` несплачені |
| Ваучери | сальдо `gift_cards` = продано − погашено | — |
| Депозити | `SUM(deposit_amount)` майбутніх = `SUM(ANZA_BETRAG)` | — |
| Стани броней | розподіл `status` = розподіл `BUCH/CI/TA` через мапу 2.8 | мапа — гіпотеза, перший прогін її і перевіряє |

Плюс три перевірки очима: одна бронь 2024 зі сніданком і знижкою — фактура ALiSiO поруч
із `RECHNUNGSDRUCK`; один гість з умлаутом і дитиною; одна фірмова бронь з дебіторською
фактурою.
