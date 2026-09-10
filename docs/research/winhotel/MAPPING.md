# Winhotel.MX → ALiSiO: мапа таблиць для `winhotel-import`

Стан 10.09.2026, сесія 5, задача 2. Джерело — `extract-out/main/` (DDL, колонки, зразки
довідників; знімок 11.03.2025). Кожна з 11 сутностей §2.3 задачі має таблицю або чесне
«не знайдено». Позначки: **упевнено** — колонки, зразок або тригер підтверджують;
**гіпотеза** — з назви й колонок, перевірити на першому прогоні імпорту.

## Спершу — п'ять правил бази, без яких мапа читається неправильно

1. **Рядок не видаляється — він дістає `TA_STATUS >= 1000`.** Кожен запит імпорту має
   `WHERE TA_STATUS < 1000` (у DDL це умова 442 рази). Значення нижче 1000 — стан:
   `0` новий/чинний, `1`, `400`/`500` — етапи фактурування рядка рахунку (тригер
   фіскалізації спрацьовує на 399–599; `500` = виставлено), точна таблиця станів —
   з першого прогону (`SELECT TA_STATUS, COUNT(*) … GROUP BY 1`).
2. **Суми — домени `N_BETRAG NUMERIC(12,3)`, `BETRAG2 NUMERIC(12,2)`, `BETRAG4 DECIMAL(12,4)`**
   (`DDL.sql:265–283`). `table-columns.tsv` показує їх як `BIGINT` — це тип ЗБЕРІГАННЯ зі
   шкалою, не домен; `CAST(… AS VARCHAR)` в isql віддає **вже масштабоване** `141.000` = 141,00 €.
   **Ділити на 1000 не треба** — виправлено після живого проходу 10.09 (рецензія А: перша
   редакція мосту ділила і віддавала ніч як 0.141). Округлювати `money()`.
3. **FK майже немає** (6 на 258 таблиць): `BELEGUNG → GASTKONT`, `BUCHKONT → GASTKONT`,
   `ANG_LEISTUNG → ANGEBOT`, `PREISSPLITTING → PREISLIST`, `ZIMMLEIST → ZIMMSTAM`,
   `GK_MANU_SPLIT → GASTKONT`. Решта — за іменами (`LNR_GK`, `GK_LNR`, `ADR_LNR`,
   `GASTNR_1`), сироти можливі: рахувати й звітувати.
4. **Charset NONE = CP1252.** Умлаути в `samples.txt` уже перекодовані; імпортер читає
   байти й декодує `windows-1252`.
5. **`MAND_NR`** є майже всюди — два манданти в `MANDANT`, реальні дані під одним;
   фільтрувати `MAND_NR = 1` (перевірити на прогоні, що другий мандант порожній).

## 1. Об'єкт і номери → `properties`, `unit_types`, `units`

| | |
|---|---|
| Таблиці Winhotel | `MANDANT` (2), `KATESTAM` (11), `ZIMMSTAM` (37) — **упевнено** |
| Об'єкт | `MANDANT.LNR = 1`: `NAME1..3`, адреса, `LAND_ISO`, `BETRIEBNR`, `RECHNR` (лічильник фактур), `RECHNR_VORSPANN` (префікс), `FISKAL_AKTIVE`. Другий рядок — перевірити, чи не тестовий |
| Категорії | `KATESTAM`: `LNR`, `KATEGORIE` (`ES SD DZD SK DZK V B`), `ANZ_KATE` (кількість номерів), `ANZ_BETTEN`, `ANZ_ERW`, `ANZ_K1` (макс. дорослих/дітей), `PREISLIST` (номер прайс-листа 1–7), `PSEUDO` (1 = `SEM`, `PS`), `ONLINE_VERFUGBAR`, `BEMERK1` — назва для гостя. Технічні рядки `LNR 0` і `99999` — пропустити |
| Номери | `ZIMMSTAM`: `LNR`, `ZINR` (текст: `102`…`244`, `9001`, `9500`–`9502`, `9999`), `LNR_KATE → KATESTAM.LNR`, `STOCK` (1/2/3; `99` у псевдо), `BETTZAHL`, `GESPERRT`, `VERMIETJN`, `ONLINE_VERFUGBAR`. Рядок `LNR 9999`/`ZINR 9999` з `NULL`-полями і `TA_STATUS 1000` — технічний |
| Як відрізнити псевдо | `KATESTAM.PSEUDO = 1` **або** `ZIMMSTAM.STOCK = 99` **або** `ZINR >= 9000` — усі три збігаються на цих даних. `9001 Seminarraum` → `event_spaces`; `9500–9502`, `9999 Pseudozimmer` — «сховище» для броней без номера (channel manager кладе туди сторно і нерозподілені: `FREIMELD_PRO.STORNO_IN_9999_VERSCHIEBEN`, `RES_MIT_ZAHLUNG_AUF_9999`) → **не імпортувати як `units`**, а трактувати брони на них як без призначеного номера |
| Наша ціль | `properties` (1) ← `MANDANT`; `unit_types` (7) ← `KATESTAM` `PSEUDO=0`; `units` (31) ← `ZIMMSTAM` `ZINR < 9000`; заселеність 1–4 — не категорії, а `price_occupancy` (інваріант 15; у Winhotel це `MATCHC` `ÜF_1..ÜF_4` в `PREISLIST`) |
| Незрозуміло | `ZIMMSTAM.PREISLIST` дублює `KATESTAM.PREISLIST` — яке чинне при розбіжності; `ZIMMERART -1` на всіх справжніх номерах — значення невідоме |

## 2. Гості (три адреси, `Gast-Nr 1/2/3`) → `guests`, `reservation_guests`

| | |
|---|---|
| Таблиці Winhotel | `ADRESSEN` (37 088), `ADR_ZUSATZ` (20 093), `GASTHIST` (18 211), `GASTKREF` (16 696), `ADR_DATENSCHUTZ` (61 305), `DATENSCHUTZSTAM` (3), `GASTKSIGNO` (3), `DOKUMENT` (17 542) — **упевнено** |
| Що таке «три адреси» | Це **`GASTKONT.GASTNR_1`, `GASTNR_2`, `GASTNR_3`** — три посилання на `ADRESSEN.LNR` з одного рахунку гостя (індекси `GASTKONT_GASTNR1/2/3`): за екраном Winhotel — замовник/гість/платник (порядок підтвердити на прогоні: процедура `PROC_GET_GK3_ADR` віддає всі три). Плюс на самій `ADRESSEN` є **вбудований супутник** (`BEGLEIT`, `BEGLEIT_V`, `BEGLEIT_G`, `B_STRASSE/B_PLZ/B_ORT/B_LAND`, `ID_NR_BEGL`) і до **п'яти дітей** (`K1..K5`, `K*_GEB`, `K*_NNAME`, `K*_TELE`, `ID_NR_K*`) — тобто одна адреса = домогосподарство |
| Ключові колонки `ADRESSEN` | `LNR`, `ADR_WAHL` (тип → `ADR_AUSWAHL`, 3 типи), `ANREDE`, `TITEL`, `NAME1` (прізвище/фірма), `NAME2` (ім'я), `NAMENZUS`, `STRASSE`, `PLZ`, `ORT`, `LAND`/`LANDKENN`, `SPRACHE`, `TELE1..3`, `E_MAIL`, `GEBDAT`, `GESCHLECHT`, `ID_NR` (документ), `ID_NR_AUSGESTELLT`, `ST_ANGEH` (громадянство), `KFZ_KENNZ`, `NEWSLETTER`, `BEMERK` BLOB, `BEMERK2`, `WUNSCH_ZI`, `SUCHNAME`, `MATCHCODE`, `GASTNR` (старий номер), `ERF_DATUM`, `KOR_DATUM`, `DS_VORGENOMMEN`/`DS_VERSION` (GDPR: чи проведено анонімізацію / версія згоди), `PASSWORT` (гостьовий портал) |
| Історія | `GASTHIST` — по рядку на перебування: `ADR_LNR`, `VONDATUM`–`BISDATUM`, `TAGE`, `ZINR`, `PERSONEN`, `LOGIUM`/`SONSTUM` (виручка), `RECH_NR` — швидке джерело «скільки разів був» без агрегації `GASTKONT` |
| Референси | `GASTKREF.GK_LNR → GASTKONT`: `REF_NR` (номер броні OTA), `EXT_SOURCE`, `EXT_REFNR`, `REF_STORNO`, `PRECHECKIN_DONE` |
| GDPR | `ADR_DATENSCHUTZ`: адреса × пункт згоди (`DATENSCHUTZSTAM_LNR`: 3 пункти) × коли/хто. Наш `guest_registrations`/retention — імпортувати як факт згоди з датою. Процедура **`UPD_ADR_TO_MUSTER`** у базі анонімізує ВСІ адреси разом (`STRASSE = 'Musterstr. 99'`, `ORT = 'Musterort'`, `PLZ = '99999'`, обнуляє телефони/банк/дати народження/e-mail) — це інструмент вендора для тестових копій, не ретенція; у знімку вона не виконана (є справжні адреси) |
| Наша ціль | `guests` ← `ADRESSEN` з `ADR_WAHL` = гість; супутник і діти → `reservation_guests` на відповідних бронях (або окремі `guests`, якщо мають `ID_NR`); `GASTNR_2/3` → `reservation_guests` |
| Дублікати | 37 тис. адрес на 31 номер за ~20 років: правило злиття імпортеру — `SUCHNAME` + `PLZ` + `GEBDAT`; `MATCHCODE` — ручний ключ готелю |
| Персональні дані | зразків не буде; лічильник і колонки — усе |

## 3. Компанії / дебітори (`Debitoren-Nummer` 10000–12599) → `companies`

| | |
|---|---|
| Таблиця Winhotel | **та сама `ADRESSEN`** — **упевнено**: `DEBI_NR INTEGER` на адресі; окремої таблиці фірм немає (`ANSPRECHP` контактних осіб — 0 рядків; view `VIEW_ADR_ANSPRECHP_VERB` показує `DEBI_NR` поруч із контактом) |
| Ключові колонки | `ADR_WAHL` (тип «фірма» — який із трьох, побачити в `ADR_AUSWAHL.BEZEICHN` на прогоні), `NAME1` (назва), `DEBI_NR` (10000–12599), `STEUERNUMMER`, `PR_CODE` (фірмовий прайс-код 3 = Firmenpreise або 8/10 корпоративні), `RABATT` (%), `PROV_PROZ` (комісія — для турагентів), `LOGI_OK`/`KURT_OK`/`LOGI_BETRAG` (що фірма оплачує: проживання, курортний збір, ліміт), `KONTONR`/`IBAN`/`BANK`/`BLZ`/`SWIFT` — **не імпортувати** |
| Лічильник дебітора | `MANDANT.LFDDEBITOR` (FLOAT) + `LFDDEBIOK` — наступний номер; `DEFAULT_DEBINR` — дебітор за замовчуванням для готівкових |
| Наша ціль | `companies` ← `ADRESSEN WHERE DEBI_NR IS NOT NULL` (або `ADR_WAHL` = фірма); `DEBI_NR` зберегти як зовнішній код для звірки з DATEV; знижка → `price_rules`/поле на `companies` |
| Незрозуміло | чи всі фірми мають `DEBI_NR`, чи лише ті, що платили з відстрочкою — перевірити `COUNT(*) WHERE DEBI_NR > 0` проти `ADR_WAHL` |

## 4. Брони (`Beleg-Nr`, `Verkn-Nr`, стани) → `reservations`, `reservation_sub_bookings`

| | |
|---|---|
| Таблиці Winhotel | **`GASTKONT`** (52 941) — головна; **`BELEGUNG`** (52 996) — зайнятість; `SEGMSTAM` (10); `GASTKREF`; `ANGEBOT`/`ANG_LEISTUNG` (пропозиції) — **упевнено** (процедура `CO_GK_BELEG` бере `GASTKONT.LNR` як `BELEGNR`) |
| `Beleg-Nr` | = **`GASTKONT.LNR`**. Усі дочірні таблиці посилаються на нього як `GK_LNR`/`LNR_GK`/`BELEGNR` |
| `Verkn-Nr` | = **`GASTKONT.VERK_NR`** — номер групи; для одиночної броні дорівнює власному `LNR` (процедура `UPDATE_VERKNR_XB` чинить `verk_nr = min(lnr)` групи). `PARTY_NR`, `SHARE_NR` — сусідні групування (party у номері, поділ номера) |
| Дати, номер | `GASTKONT.VONAUFH`–`BISAUFH`, `AUFTAGE`; `LNR_KATE`, `LNR_ZINR` (0/NULL = без номера); `RESV_KATE_LNR` — заброньована категорія до переселення; `UMZUG_ZINR` — переселення. `BELEGUNG` дублює дати/категорію/номер по рядку на сегмент перебування (`LNR_GK → GASTKONT`), з `ANREISE = 1899-12-30` на сміттєвих рядках — **брати дати з `GASTKONT`**, `BELEGUNG` — лише для переселень |
| Стан | три колонки: `BUCH_STATUS` (0 = звичайна; 100 = Option/Angebot — у коді `buch_status = 100` окремо), `CI_STATUS` (0 очікується, 1 заселено, 2 виїхав — у коді `ci_status < 2` = «в домі або до заїзду»), `TA_STATUS` (< 1000 живий; 1000 видалено/сторновано разом із `STORNO_DATUM`). Reservierung/Angebot/Option/Gastbestätigung з екрана — комбінація `BUCH_STATUS` + `BU_ST_OPTION` (термін опції; `>= 10000` — особливий режим) + `RES_OPTION2` + `ANG_LNR` (є пропозиція). **Точну таблицю станів зняти на першому прогоні:** `SELECT BUCH_STATUS, CI_STATUS, TA_STATUS, COUNT(*) FROM GASTKONT GROUP BY 1,2,3` |
| `Buchungs-Segm.` | `GASTKONT.MARKSEG → SEGMSTAM.SEGMCODE` (10 сегментів; `SEGMSTAM` несе ще й ціни пансіону за сегментом) |
| `Referenz-Nr` | `GASTKREF.REF_NR`/`EXT_REFNR`, `EXT_SOURCE` (Booking.com тощо); `ONLINE_BUCHUNGEN.BUCHNR` + `PROVIDER` — вхідний номер |
| `Zimmer FIX` | не знайдено окремою колонкою; кандидати — `GASTKONT.KONTINGENT`, `TEMP_RES`, або `STATUS1/STATUS2`. **Гіпотеза**: перевірити на прогоні, яке поле міняється при «FIX zugesagt» |
| `Anzahlung` | `GASTKONT.ANZA_BETRAG` (BIGINT ×1000), `ANZA_DATUM`; послуга `LEISTSTA 114 ANZAHLUNG` (WG 8 «Kein Umsatz») лягає на рахунок при отриманні; `MANDANT.ANZAHLUNG_LEIST_LNR`, `ANZAHLUNG_NACH_STEUER` |
| `AGB/Storno` | не знайдено на броні (див. п. 9) |
| Особи | `PERSZAHL`, `ANZKINDER`, `ANZKINDER2`, `ANZKLEINKIND`, `ANZJUGEND` |
| Ціна | `PR_CODE` (прайс-код броні), `TARIF`; сама ціна — у рядках `BUCHKONT` (п. 5) |
| Наша ціль | `reservations` ← `GASTKONT` (1:1); `VERK_NR` → `reservation_sub_bookings`/group id; `MARKSEG` → `booking_sources`; `GASTKREF.REF_NR` → зовнішній номер; `BELEGUNG` з різними номерами на один `GASTKONT` → переселення (наш `reservation_sub_bookings` або історія) |
| Незрозуміло | `BELEGUNGSART` (0 звичайна, ≥ 3 інше — семінар/апартамент?); `ABR_TYP`; `REG_MODE`; `GAST_GR` — усе рахувати `GROUP BY` на прогоні |

## 5. Послуги на броні (`Leistungen`, `Menge × Tage`, щоденні) → `reservation_line_items`, `service_orders`

| | |
|---|---|
| Таблиці Winhotel | **`BUCHKONT`** (195 303) + довідник **`LEISTSTA`** (132), `WARENGRU` (9), `KATESTAM_LEISTUNG` (7), `GLOB_LEISTUNG` (7), `PREISSPLITTING` (455) — **упевнено** |
| Рядок рахунку | `BUCHKONT`: `GK_LNR → GASTKONT` (FK), `LEIST_LNR → LEISTSTA.LNR`, `VON`–`BIS`, `TAGE`, `ME` (Menge), `E_PREIS` (ціна одиниці), `TAGBETRAG` (за день), `GBETRAG` (разом = `ME × TAGE × E_PREIS`), `BEZEICHN` (текст на момент запису), `PRL_LNR → PREISLIST.LNR` (з якого цінового рядка), `ZIPREIS`/`PAUSCH` (ціна номера / пакет), `AUFP` (на особу), `RECHNR`/`LNR_CO`/`RE_LAUF` (у якій фактурі, чек-аут), `STO_KENNUNG` (1/2 сторно), `UMB_GK_LNR` (перенесено на інший рахунок), `ONLINE_GEBUCHT`, `GS_LNR` (ваучер), `BASIS_LNR` (базовий рядок для похідних), `ZAHLUNG_LNR` |
| Щоденна (зірочка) | не окремий прапорець на рядку — рядок із `VON < BIS` і `TAGE > 1` є щоденним; на довіднику `LEISTSTA.M_FIX` (фіксована) / `KATESTAM_LEISTUNG.TAEGLICH` (автопослуга категорії щодня) |
| Übernachtung | `LEISTSTA LNR 1 LOGIS` (WG 100, STS 2 = 7 %), `67 ÜN`, `78 LOG_FIRMEN`; сніданок розділено: `11 FS Frühstück-Speisen` (WG 200, STS 2 = 7 %), `96 FG Frühstück-Getränke` (WG 300, STS 3 = 19 %) — **Winhotel уже спліщить сніданок на їжу/напої**, і саме так робить наш `service-vat-split` |
| ПДВ на рядку | `LEISTSTA.STS` — **код** (1/2/3), не відсоток; ставка на дату — з `STEUSTAM` за `VON`–`BIS` (п. 11). У `FAKT_ERLOESE.STEUERSATZ` і `FISKAL_RECH_POS.STSATZ` вона вже записана числом |
| Спліт ціни | `PREISSPLITTING` (FK → `PREISLIST`): як ціновий рядок розкладається на послуги (`LEISTUNG_LNR`, `BETRAG`/`BETRAG_PROZ`, `TAEGLICH`, `PROPERSON`) — джерело того, що «ÜF 141 €» = Logis 7 % + сніданок |
| Наша ціль | Logis-рядки → нічна ціна `reservation_line_items` **через `priceNights()`** з відновлених тарифів (п. 8), а `GBETRAG` з Winhotel — як контрольна сума для звірки (інваріант 16); решта послуг → `service_orders`/`reservation_line_items` з `unit_price = E_PREIS / 1000`, кількість `ME`, днів `TAGE` |
| Незрозуміло | `ZIPREIS`/`PAUSCH` як `SMALLINT`-прапорці проти `PREISTYP` у `PREISLIST`; `AUTO_WOHER` (звідки авто-рядок) |

## 6. Фактури (`Rechnung-Nr`, рядки, `Debitor`, `offener Betrag`, ПДВ-рекапітуляція) → `invoices`, `fin_invoice_lines`, `fin_invoice_tax_totals`

| | |
|---|---|
| Таблиці Winhotel | **`RECHNUNG`** (33 059), **`RECHNUNGSDRUCK`** (32 915), `CHECKOUT` (31 012), **`AUSGBUCH`** (65 396), `FAKT_ERLOESE` (88 637), `RE_NACHDRUCK` (42), `RECHNUNG_INFO` (178) — **упевнено** |
| `Rechnung-Nr` | `RECHNUNG.RECHNR` (INTEGER) + `RECHNR_ALPHA` (з префіксом `MANDANT.RECHNR_VORSPANN`); лічильник — генератор **`GEN_RECHNUNGNR`** і дзеркало `MANDANT.RECHNR`. Остання = `GEN_ID(GEN_RECHNUNGNR, 0)` або `MAX(RECHNR)` — у `COUNTS-2025-03.md` |
| Шапка | `RECHNUNG`: `GK_LNR` (рахунок гостя), `VERK_NR` (групова фактура), `LFDNR` (номер у межах рахунку), `DATUM_ZEIT`, `USERID`, `LNR_CO → CHECKOUT` (подія чек-ауту, `RE_LAUF`), `STORNO_KZ`, `SIGN_NICHT_OK`. Адреса одержувача — **не на шапці**: береться з `GASTKONT.GASTNR_1..3` через `BELGEIT_ALS_RE_EMPF` / `RECHNUNGSDRUCK.M_DEBIRECHN`; `RE_NACHDRUCK` зберігає адресу на момент повторного друку |
| Рядки | `RECHNUNGSDRUCK` (те, що на бланку): `RECHNR`, `DRUCKNR`, `BK_LNR → BUCHKONT`, `LEIST_LNR`, `VON`–`BIS`, `TAGE`, `ME`, `EBETRAG`, `GBETRAG`, `GASTNAME`, `GASTVORNAME`, `ZINR`, `M_DEBIRECHN` (дебіторська), `ARRANG_SORT`. Це той рядок фактури з `Gastname`/`Zi-Nr` з екрана |
| Оплати в тілі | `ZAHLUNGEN.RE_NR = RECHNR` — платежі прив'язані до фактури і друкуються в тілі; `BUCHKONT.ZAHLUNG_LNR` — зворотний зв'язок |
| `Debitor` / `offener Betrag` | `AUSGBUCH` (Ausgangsrechnungsbuch): `RECHNR`, `ADR_LNR` (дебітор), `RECH_DAT`, `UMSATZ`, `STEUERSATZ`, `KONTO_NR`, `DB_STATUS` — стан оплати; `ZAHLUNGEN.M_DEBITOR`/`MAHNS`/`DEBI_BEZ_BETR` — дебіторський платіж і рівень нагадування; `ZAHLUNG_ZUS` — погашення. Процедура `GET_OFFEN_ZAHLBETRAG(belegnr)` = `SUM(BUCHKONT.GBETRAG) − SUM(ZAHLUNGEN.BETRAG)` по рахунку гостя (обидва `TA_STATUS < 1000`) — **саме так Winhotel рахує відкриту суму**; для дебіторів по фактурах — `AUSGBUCH` мінус `ZAHLUNGEN WHERE RE_NR = …` |
| ПДВ-рекапітуляція | окремої таблиці немає (`REDRUCK_STEUER` 0 рядків); рахується з рядків: `FAKT_ERLOESE` (по проводці: `ST_SCHL` код + `STEUERSATZ` число) або `FISKAL_RECH_POS.STSATZ`. Знижка розподіляється по ставках у `PREISSPLITTING` (`PROZ_VOM_REDUZ_BETR`, `BRUTTO_NETTO`) |
| Наша ціль | `invoices` ← `RECHNUNG` (номер, дата, `reservation_id` через `GK_LNR`, `company_id` через `AUSGBUCH.ADR_LNR`, сторно через `STORNO_KZ`); `fin_invoice_lines` ← `RECHNUNGSDRUCK`; `fin_invoice_tax_totals` — перерахувати з рядків із записаною ставкою (інваріант 18 — не з `STEUSTAM`); `invoice_counters` стартує з `MAX(RECHNR)+1` |
| Незрозуміло | `RE_LAUF` (порядковий номер фактури в межах чек-ауту?) проти `LFDNR`; чи `FAKT_ERLOESE` = 1:1 з `RECHNUNGSDRUCK` (88 тис. проти 33 тис. — ні: по проводці на день) |

## 7. Оплати і TSE → `fin_folio_payments`, `fin_fiscal_settings`

| | |
|---|---|
| Таблиці Winhotel | **`ZAHLUNGEN`** (26 115), **`DEVISEN`** (24), `ZAHLUNG_ZUS` (3 286), `KASSEN` (206), `TAG_ABS` (1 386); TSE: **`MANDANT_FISKAL`** (1), `FISKAL_BK` (79 610), `FISKAL_RECHNUNG` (12 837), `FISKAL_RECH_POS` (42 509), `FISKAL_ZERO_REC` (3 607), `TEMP_FISKAL_BK` (85 987) — **упевнено** |
| Спосіб оплати | `ZAHLUNGEN.LNR_DEVI → DEVISEN.LNR`: `KURZBEZ`/`BEZEICHN` (bar, Karte, Debitor, Überweisung, Gutschein…), `ZAHLUNGSART` (клас), `M_DEPITOR` (дебіторська), `ZVT_AKTIV` (EC-термінал), `KURS_FAKT` (курс валюти), `KONTONR`. 24 рядки — зняти зразком на прогоні (без персональних даних) |
| Платіж | `BETRAG` (×1000), `BUDAT`+`UHRZEIT`, `LNR_GK` (рахунок гостя), `GASTNR_1` (адреса платника), `RE_NR` (фактура), `TG_ABS`/`TAG_ABS_LNR` (денне закриття), `M_DEBITOR`, `MAHNS`, `SIGNATUR_OK`, `GASTAUSLAGE` (витрати за гостя), `GS_EXTERN_KEY`/`GS_EXTERN_GSNR` (зовнішній ваучер) |
| `KASSEN` (206) | касова книга поза рахунками гостей: витрати (`AUSG_19`), приватні внески/зняття (`PRIVATEIN`/`PRIVATENT`), транзит каса→банк (`GELDTRANS`), `KASSENAUSG` — тобто **не оплати гостей, а Kassenbuch**; для імпорту в `fin_*` — як касові операції без броні |
| **Де лежить TSE-підпис** | по три рівні: (а) **`MANDANT_FISKAL`** — конфігурація: `CASHBOX_ID` (36 симв., UUID), `QUEUE_ID`, `SCU_ID`, `TSE_SER_NUM` (64 симв. hex), `PUBLIC_KEY VARCHAR(2048)`, `CERTIFICATE` (порожній), `REC_TYPE = ecdsa-plain-SHA384`, `KASSENSERIENNUMMER`, `AKTIVIERUNG_DATUM_ZEIT = 2021-09-09`, `AKTIVIERUNG_XML`, `URL http://<host>:3076`; (б) **`FISKAL_BK`** — кожен рядок рахунку в момент фіскалізації з `SIGNATUR VARCHAR(1024)`, `GEGEN_SIGNATUR`, `FISKAL_REF`, `SIGN_OK`, `SIGN_DATUMZEIT`; (в) **`FISKAL_RECHNUNG`** — квитанція на фактуру з `REC_REF`/`REC_ID`/`REC_STATE` і 16 парами `SIGNn_CAPTION`/`SIGNn_DATA` (ті рядки, що друкуються на чеку: серійний, лічильник підписів, час старту/кінця, підпис, `Publickey`). **`Publickey` — у `MANDANT_FISKAL.PUBLIC_KEY` і, ймовірно, серед `SIGNn_DATA` на квитанції** (200-символьні `SIGN8_DATA`/`SIGN16_DATA`) |
| Постачальник TSE | CashBox / Queue / SCU / `http://…:3076` — словник **fiskaltrust.Middleware** (порт 3076 з `ecdsa-plain-SHA384`), не fiskaly. Підтвердити в готелі |
| Наша ціль | `fin_folio_payments` ← `ZAHLUNGEN` (спосіб → наш `payment_method` через мапу `DEVISEN`); `KASSEN` → касові операції `fin_*`; TSE-дані **не імпортуються** в наші таблиці — це історія чужої каси, її зберігають експортом TAR/DSFinV-K 10 років; для ALiSiO — нова TSE (fiskaly) з власним серійником, `fin_fiscal_settings` заповнюється заново |
| Незрозуміло | `ZAHLUNGEN.WOHER` (джерело), `LNR_CO` на платежі (чек-аут), `TATIGK` (текст) |

## 8. Ціни (сезони, заселеність 1–4, LOS, Aufbettung, фірмові −10 %) → `seasons`, `season_prices`, `price_occupancy`, `price_los_tiers`, `extra_occupancy_rules`, `price_rules`

| | |
|---|---|
| Таблиці Winhotel | **`PREISCODE`** (10) → **`SAISSTAM`** (23) → **`PREISLIST`** (341) → `PREISSPLITTING` (455), `PREISLIST_VERERB` (168), `RABATT` (1), `TEMPLATE_PREISOPTION` (2), архіви — **упевнено** |
| Прайс-код | `PREISCODE.LNR`: 1 Standard, 2 Pauschalen, 3 Firmenpreise, 4 Booking.com, 5 HRS, 6 VPW, 7 Wanderreisen, 8 корпоративний A, 9 WEB.MX, 10 корпоративний B (`TA_STATUS 1000` = вимкнені 2, 6, 10) — це наші **тарифи** (`rate_plans`) і водночас джерела |
| Сезони | `SAISSTAM`: `PRCODE`, `SAISON` (номер сезону, спільний ключ із `PREISLIST.SAISON`), `VON`–`BIS`, `BEMERK` (`HS`/`NS`, `Firma HS`), дні тижня `WO_MO..WO_SO`, `NUR_WE_PR`. На 2025: `100` NS 01.01–28.02, `102` HS 01.03–31.12 (Standard); `101`/`103` — ті самі для Firmenpreise; `700` Booking.com 2019–2050 (безсезонний); `701–705` — одноденні 27.08.2024 (тестові) |
| Ціна | `PREISLIST`: `PRCODE_LNR`, `PREISLIST_LNR` (= `KATESTAM.PREISLIST` 1–7, тобто категорія), `SAISON`, `MATCHC` (`ÜF_1`…`ÜF_4` — **заселеність 1–4 особи**; `FA_SD`, `FA_DZD`… — фірмові; `FIRMA_B_DZD_1/2` — корпоративні), `BETRAG` за ніч (×1000), `ZIMMERPREIS` (1 = ціна за номер, 0 = за особу), `PAUSCHALE`, `MIN_TAGE`/`MAX_TAGE` (LOS), `EZZUSCHLAG`/`EZPREIS`, `BETRAG_PERS` (осіб), `KURTAX_INKL`, `ONLINE_BUCHBAR`, `FM_RATEID` (`92493` для Booking-рядків = rate id у channel manager), `LEIST_LNR` (1 Logis / 78 Logis Firmen). Зразок 2025 HS Standard: SD 159, DZD 89/99/118 (1/2/3 ос.), SK 74/89/108, DZK 59/79, V 59/79/98/117 (1–4 ос.), B 89/99/118 |
| Фірмові −10 % | не відсоток, а **окремі рядки** прайс-коду 3 з `MATCHC FA_*` (66,30/72,90/80,10/84,60 для SD) і `LEIST_LNR 78 Logis Firmen`; `RABATT` (1 рядок) і `ADRESSEN.RABATT` — додатково |
| LOS ≥ 3 | `PREISLIST.MIN_TAGE` (у зразку всюди 0) і послуга `75 NACHLASS Nachlass ab 3 Nächte 5,00 p.P.` — знижка за тривалість оформлена **як послуга з від'ємною сумою**, не як правило |
| Aufbettung 19 € | `LEISTSTA 68 AUFBETT. Aufbettung 19,000` (WG 100 Logis, STS 2) і `36 ZU-BETT Zustellbett`; `PREISLIST_VERERB.AUFSCHLAG_*` — надбавки по вікових групах |
| Наша ціль | `PREISCODE` → `rate_plans`; `SAISSTAM` → `seasons`; `PREISLIST` з `ÜF_n` → `price_occupancy` (n осіб) на `unit_types` × сезон; `MIN_TAGE` → `price_los_tiers`; Aufbettung → `extra_occupancy_rules`; фірмові `FA_*` → або окремий `rate_plan` «Firmen», або `price_rules` −10 % (перевірити, що `FA_* = 0,9 × ÜF_1`: 66,30 ≠ 0,9 × 76; ні — це окремі ціни, отже **окремий тариф**) |
| Ціни 2027 | у знімку 03.2025 немає (найпізніший сезон 2025); на папері (журнал §5) — заводити руками |
| Незрозуміло | `PREISTYP` (0 усюди в зразку), `SAISON 1/2/10/20/22/30/31/50–53` — старі роки з `TA_STATUS 0`, тобто чинні рядки без чинного сезону — брати лише сезони, чиї `VON`–`BIS` покривають дату |

## 9. Політики Storno («Messe ab 30» і решта) → тариф / текст на броні

| | |
|---|---|
| Таблиця Winhotel | **не знайдено як дані.** `STORNO_BED` (0 рядків) має точно потрібну форму (`VONTAGE`/`BISTAGE` днів до заїзду, `MAXVORANR`, `PRO_BETRAG` %, `BETRAG`, `BEZEICHN`) — модуль є, готель його не заповнював. Перевірено також: `PREISLIST` (немає колонок сторно), `LEISTSTA` (є лише **послуга** `22 STORNO Stornogebühren Logis lt. AGB` — так нараховують штраф руками; і `12 NOSHOW`), `MANDANT` (немає), `FREIMELD_PRO.AN_AB_STORNO_BED_SENDEN` (прапорець передачі умов провайдеру — 0), `TEXTE` (691 текстових блоків — **«Messe ab 30» найімовірніше лежить тут як текст умов у листі/AGB**; на прогоні: `SELECT LNR, BEREICH, BEZEICHN FROM TEXTE` без тіла) |
| Наша ціль | політики скасування в нас живуть на тарифі (`docs/tasks/2026-09-07-restrictions-per-rate-plan.md`); завести руками з екрана/AGB готелю; штрафи з історії — рядки `BUCHKONT` з `LEIST_LNR 22`/`12` → `reservation_line_items` |

## 10. Сертифікати / ваучери → `gift_cards`

| | |
|---|---|
| Таблиця Winhotel | **не знайдено як реєстр.** Модуль `GUTSCHEINE`/`GUTSCHEIN_PAKETE`/`GUTSCHEIN_MOTIVE`/`PARAMETE_GUTSCHEIN` — 0 рядків (форма є: номер `MAN_GSNR`, `BETRAG`, `GUELTIG`, `EINGELOEST`, `LNR_GK` погашення). Ваучери проходять **як послуги**: `LEISTSTA 7 GUTSCHEIN Gutschein für Hotel` (HG 10, KONTONR 1371 — рахунок зобов'язань), `55 GS Gutschein` (KONTONR 3786), `95 GSS Gutschein Sauna` (3787), `94 KAU Kaution` — продаж = рядок `BUCHKONT` з цим `LEIST_LNR` на рахунку продавця; погашення = платіж `ZAHLUNGEN` зі способом `DEVISEN` «Gutschein» або `GS_EXTERN_KEY`/`GS_EXTERN_GSNR` (зовнішня система ваучерів) і `BUCHKONT.GS_LNR` |
| Непогашені | реєстру немає → «непогашені ваучери» = продані (`BUCHKONT` з `LEIST_LNR IN (7,55,95)`, `TA_STATUS < 1000`) мінус погашені (`ZAHLUNGEN` через «Gutschein»-`DEVISEN`) — лише як сума, без прив'язки до номера ваучера. SQL — у `COUNTS-2025-03.md` |
| Наша ціль | `gift_cards` — заводити з паперового/зовнішнього реєстру готелю; з бази імпортувати лише сальдо як контрольне число |

## 11. Налаштування ПДВ (коди 7/19, дата переходу Speisen на 7 %) → `fin_tax_rates`

| | |
|---|---|
| Таблиця Winhotel | **`STEUSTAM`** (7) — **упевнено** |
| Форма | `STS` — код (1 = 0 %, 2 = знижена, 3 = стандартна), `STSATZ` — відсоток, `VON`–`BIS` — чинність, `STLAND D`, `STS_KASSE`, `FISKAL_ZUWEISUNG` (код ставки для TSE: 4 / 1 / 0), `STEUER_ZUWEISUNG_SIGNATUR`. Історія: код 2 = 7 % до 30.06.2020, 5 % 07–12.2020, 7 % з 01.01.2021; код 3 = 19 % / 16 % / 19 % ті самі періоди |
| Speisen 7 % | у довіднику **немає** окремого рядка «Speisen 7 % з дати» — код 2 (знижена) з 2005 = 7 %, тобто перехід сніданку-їжі на 7 % відображений **на послугах** (`LEISTSTA.STS = 2` для `FS`, `EFS`; `3` для `FG`, `EFG`, `FRST 105`) і в архіві `ARCHIV_LEISTSTA` (823 рядки — там видно, коли `STS` послуги змінили). Дата переходу — `ARCHIV_LEISTSTA.KOR_DATUM` для `LNR 11/128` |
| Ставка на нарахуванні | `FAKT_ERLOESE.STEUERSATZ`, `FISKAL_RECH_POS.STSATZ`, `AUSGBUCH.STEUERSATZ` — число, записане в момент проводки; довідник назад не читається — **той самий інваріант 18** |
| Наша ціль | `fin_tax_rates` ← `STEUSTAM` (код → назва, ставка, `valid_from`/`valid_to`); історичні фактури — з записаною ставкою |

## Що не знайдено — коротко

| Сутність | Стан |
|---|---|
| Політики Storno | таблиця порожня; умови — текст (`TEXTE`) і штраф-послуга |
| Реєстр ваучерів | таблиця порожня; ваучери — послуги + спосіб оплати |
| `Zimmer FIX zugesagt` | колонка не ідентифікована (кандидати `KONTINGENT`, `STATUS1/2`) |
| Адреса одержувача на фактурі | не на `RECHNUNG`; через `GASTKONT.GASTNR_n` + `RE_NACHDRUCK` |
| ПДВ-рекапітуляція | не таблиця; з рядків із записаною ставкою |
| Ціни 2027 | у знімку немає |
