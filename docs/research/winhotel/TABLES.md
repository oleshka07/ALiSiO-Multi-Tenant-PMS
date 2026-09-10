# Winhotel.MX — усі таблиці й лічильники

Джерело: `extract-out/main/table-counts.by-size.tsv` і `table-columns.tsv` (знімок
`WINHOTEL.fbk` від **11.03.2025**, Firebird 3.0, ODS 12.0, 258 таблиць, 18 view, ~330
процедур, 292 тригери, 6 FK). Лічильник — `COUNT(*)` включно з логічно видаленими
рядками: у Winhotel рядок не видаляється, а отримує `TA_STATUS >= 1000` («видалено»);
`< 1000` — живий. Тобто кожне число нижче — верхня межа, а не кількість чинних рядків.

Позначки: **упевнено** — назва + колонки + зразок/тригер підтверджують; **гіпотеза** —
з назви й колонок.

## A. Об'єкт і номерний фонд

| Таблиця | Рядків | Що це | Упевненість |
|---|---|---|---|
| `MANDANT` | 2 | Готель (Mandant = юрособа/клієнт програми): назва, адреса, банк, лічильник фактур `RECHNR`, префікс `RECHNR_VORSPANN`, `FISKAL_AKTIVE`, налаштування FIBU/DATEV, a-trust (AT) і `MELDEWESEN_URL`. Другий рядок — ймовірно, тестовий/порожній мандант | упевнено |
| `KATESTAM` | 11 | Категорії номерів: 7 справжніх (`PSEUDO=0`) + `SEM`, `PS` (`PSEUDO=1`) + два технічні (`LNR` 0 і 99999). `ANZ_KATE` — кількість номерів, `PREISLIST` — номер прайс-листа категорії | упевнено |
| `ZIMMSTAM` | 37 | Номери: 31 справжній + 9001/9500/9501/9502/9999 псевдо + технічний рядок `LNR 9999`. `LNR_KATE → KATESTAM.LNR`, `STOCK` поверх, `GESPERRT`, `ONLINE_VERFUGBAR` | упевнено |
| `GES_JAHR` | 8 | Господарський рік: `VON`–`BIS`, `ZIMMERZAHL`, `BETTENZAHL`, `OFFENE_TAGE`, помісячна заселеність — для статистики | упевнено |
| `SPERRZEIT` | 2 | Блокування продажу (stop-sale) за період і провайдером | упевнено |
| `OBJEKT` | 0 | Кілька будівель/об'єктів одного манданта — не використовується | гіпотеза |
| `ZIMM_EXTRAS`, `ZIMMLEIST`, `ZIMM_W_KATE`, `KATESTAM_HAUPT`, `GARAGEN`, `GAR_BELEG`, `FEIERTAG` | 0 | Атрибути номера, послуги на номер, головні категорії, гаражі, свята — порожні | гіпотеза |

## B. Гості, адреси, компанії

| Таблиця | Рядків | Що це | Упевненість |
|---|---|---|---|
| `ADRESSEN` | 37 088 | Картотека адрес — **і гості, і фірми в одній таблиці**: `ADR_WAHL` тип (→ `ADR_AUSWAHL`), `NAME1/NAME2`, адреса, `DEBI_NR` номер дебітора, `PR_CODE` прайс-код, `RABATT`, `GASTNR` (старий номер), супутник `BEGLEIT*` з власною `B_*` адресою, діти `K1..K5`, банк/картка, `DS_VORGENOMMEN`/`DS_VERSION` (GDPR), `NEWSLETTER`, `SUCHNAME`, `MATCHCODE`. **Персональні дані — не виводити** | упевнено |
| `ADR_ZUSATZ` | 20 093 | Додаткові позиції адреси: `ZA_ZIEL` (ціль: e-mail/тел./…?), `ZA_TEXT`, `KOSTENSTELLE`, підпис `UNTERSCHRIFT` BLOB | гіпотеза |
| `ADR_DATENSCHUTZ` | 61 305 | Журнал згод GDPR: адреса × пункт `DATENSCHUTZSTAM_LNR` × дата/користувач. 61 тис. на 37 тис. адрес = по кілька згод на гостя | упевнено |
| `DATENSCHUTZSTAM` | 3 | Довідник пунктів згоди (текст, HTML, прив'язка до Meldeschein) | упевнено |
| `GASTHIST` | 18 211 | Історія перебувань на адресу (агрегат: дати, ночей, номер, осіб, виручка Logis/інше, `RECH_NR`, `FIRMA_NR`) — заповнюється при виїзді | упевнено |
| `GASTKREF` | 16 696 | Референси на рахунок гостя: `REF_NR` (номер броні OTA), `INET_REF_NR`, `EXT_SOURCE`, `EXT_REFNR`, `REF_STORNO`, `PRECHECKIN_DONE`, `FISKAL_START` | упевнено |
| `GASTKSIGNO` | 3 | Цифровий підпис гостя (Meldeschein на планшеті): `SIGNATUR`, `SIGNDATA`, `IMAGEDATA` | упевнено |
| `ADR_AUSWAHL` | 3 | Довідник типів адреси (`ADR_WAHL`): 3 типи — за назвами колонок гість/фірма/турагент, формуляр фактури на тип | гіпотеза |
| `ADRESSEN_ALTER_KREIS` | 3 | Вікові групи (дорослий/підліток/дитина) для цін і курортного збору | упевнено |
| `ARCHIV_ADRESSE` | 967 | Архів змін примітки/статусу адреси (тригер `ADRESSEN_UP_ARCHIV`) | упевнено |
| `DOKUMENT` | 17 542 | Документи/листи на адресу і рахунок гостя: `WAS` тип, `MEMO` BLOB, `DATEINAME`, `BETREFF`, `CONVERSATION_ID` (e-mail) | упевнено |
| `LANDSTAM` | 51 | Країни (ISO, KFZ, група для статистики) | упевнено |
| `PLZ_ORT` | 25 180 | Довідник індекс → місто (Німеччина), не дані готелю | упевнено |
| `PLZ_STRASSE` | 245 559 | Довідник індекс → вулиця (Німеччина), найбільша таблиця бази; не дані готелю | упевнено |
| `ANSPRECHP`, `ADR_ADDON`, `ADR_MAIL`, `ADR_NACHRICHT`, `ADR_SELE`, `ADR_TELETAPI`, `ADR_TELE_PROT`, `ADR_VERKN`, `ADR_WEITERE_BEGL`, `MELDEDATEN`, `MELDEKARTEN`, `GASTARTEN`, `STATUS_GK`, `REISEZWECK`, `SELESTAM`, `SELESTAM_VERERB`, `SELEKTION_TEMP`, `MARKETING`, `MARKETING_TEMP`, `MARKETING_TEMP_HISTORY`, `TODOLIST`, `TODOLIST_ADD` | 0 | Контактні особи, розсилки, TAPI, зв'язки адрес, Meldeschein-дані, типи гостей, сегментація/селекції, маркетинг, задачі — порожні | гіпотеза |

## C. Брони, пропозиції, онлайн

| Таблиця | Рядків | Що це | Упевненість |
|---|---|---|---|
| `GASTKONT` | 52 941 | **Рахунок гостя = бронь** (`Beleg-Nr` = `GASTKONT.LNR`): `VONAUFH`–`BISAUFH`, `LNR_KATE`, `LNR_ZINR`, `GASTNR_1/2/3` (→ `ADRESSEN.LNR`), `PERSZAHL`, `ANZKINDER`, `BUCH_STATUS`, `CI_STATUS`, `VERK_NR` (`Verkn-Nr` — група), `PR_CODE`, `TARIF`, `MARKSEG` (→ `SEGMSTAM`), `ANZA_BETRAG`/`ANZA_DATUM` (депозит), `STORNO_DATUM`, `RES_OPTION2`, `BU_ST_OPTION`, `ANG_LNR` (з пропозиції) | упевнено |
| `BELEGUNG` | 52 996 | Рядок зайнятості номера/категорії на бронь: `LNR_GK → GASTKONT` (FK), `ANREISE`–`ABREISE`, `LNR_KATE`, `LNR_ZINR`, `STATUS`, `ANZ_ZI`. Один на рахунок гостя; при переселенні — кілька. `ANREISE = 1899-12-30` — нульова дата Delphi, сміттєві рядки | упевнено |
| `TEMP_BELEGTE_ZIMMER` | 14 461 | Кеш зайнятості: день × категорія → зайнято (тригери `BELEGUNG_*_ZIMMER_BELEG`); перераховується, для імпорту не потрібен | упевнено |
| `ANGEBOT` | 693 | Пропозиція (Angebot) на адресу: дати, осіб, `AKTIV`, `STO_GRUND` | упевнено |
| `ANG_LEISTUNG` | 783 | Рядки пропозиції: категорія/номер/послуга/ціна (FK → `ANGEBOT`) | упевнено |
| `ANG_KATE_ZI` | 1 | Категорія/номер у пропозиції | упевнено |
| `SEGMSTAM` | 10 | Сегменти (`Buchungs-Segm.`): код, назва, колір, і **ціни пансіону за сегментом** (`ERW_FRS/HP/VP`, `JUG_*`, `KIND_*`, `KK_*`) | упевнено |
| `ONLINE_BUCHUNGEN` | 8 047 | Вхідні онлайн-броні: `PROVIDER`, `BUCHNR`, `MEMO` (сирий XML/JSON), `VERK_NR` | упевнено |
| `ONLINETRANS_ALLE` | 148 448 | Журнал змін броней для channel manager (тригери `BELEGUNG_AI_ONLT`/`AU_ONLT`): старі дати/категорія/гості, статус обробки | упевнено |
| `ONLINE_VERBUND` | 55 730 | Стан «в домі» на рахунок гостя для інтерфейсів (телефон, каса, замок, інтернет, `WECKZEIT`) | упевнено |
| `ONLINETRANS_BK`, `ONLINE_GK_ADR`, `HIS_VERBUND`, `GR_RES_ZUS`, `WARTELISTE`, `KONTIGENT`, `ANFRAGEN`, `LASTMINUTE`, `SEGMSTAM_ERW`, `SEGMSTAM_LEIST` | 0 | Порожні супутні | гіпотеза |

## D. Послуги і рахунок гостя (Leistungen)

| Таблиця | Рядків | Що це | Упевненість |
|---|---|---|---|
| `LEISTSTA` | 132 | Довідник послуг: `KURZBEZ`, `BEZEICHN`, `HG` головна група, `WG → WARENGRU`, `STS → STEUSTAM.STS` (код ПДВ, не відсоток), `BETRAG` ціна за замовчуванням, `KONTONR` рахунок бухобліку, `M_LOGI`/`M_LEIST`/`M_FIX` прапорці; `WIWA_*` складський залишок | упевнено |
| `WARENGRU` | 9 | Групи виручки 100 Logis … 800 Kein Umsatz (`DURCHL` — транзит) + помісячний бюджет `B_JAN..` | упевнено |
| `BUCHKONT` | 195 303 | **Рядки рахунку гостя (Leistungen на броні)**: `GK_LNR → GASTKONT` (FK), `LEIST_LNR`, `VON`–`BIS`, `TAGE`, `ME` (Menge), `GBETRAG` разом, `TAGBETRAG` за день, `PRL_LNR` прайс-рядок, `RECHNR`/`LNR_CO` (у якій фактурі), `STO_KENNUNG` (сторно), `GS_LNR` (ваучер), `ONLINE_GEBUCHT` | упевнено |
| `BUCHKONT_ZUS` | 39 | Побажання/дата до рядка | упевнено |
| `ARCHIV_BUCHKONT` | 3 681 | Архів змінених рядків рахунку | упевнено |
| `ARCHIV_LEISTSTA` | 823 | Архів кожної зміни послуги (тригер `LEISTSTA_ARCHIV`) | упевнено |
| `KATESTAM_LEISTUNG` | 7 | Послуга, що автоматично лягає на бронь категорії (тут — `LEISTUNG 60` Tiefgarage 4,00 щодня на всі 7 категорій) | упевнено |
| `GLOB_LEISTUNG` | 7 | Глобальні автопослуги на кожну бронь (курортний збір тощо, з цінами по особах `PERS1..10`) | упевнено |
| `PENSSTAMLIST` | 8 | Пансіон (ÜF/HP/VP): які послуги входять, для 14 «стовпців» | гіпотеза |
| `BUCHKONT_GS`, `GK_MANU_SPLIT`, `GAST_LEISTUNG`, `IF_LEISTUNG`, `IF_GK_REFERNZ`, `KURTSTAM`, `WELLN_LEIST`, `PASSANT_KTO`, `WARENGR_BUDGET` | 0 | Рядки ваучерів, ручний спліт, послуги гостя, інтерфейсні послуги, ставки курортного збору, wellness, «пасанти» | гіпотеза |

## E. Фактури, чек-аут, бухгалтерія

| Таблиця | Рядків | Що це | Упевненість |
|---|---|---|---|
| `RECHNUNG` | 33 059 | Фактури з 31.12.2018: `RECHNR` (число), `RECHNR_ALPHA`, `GK_LNR`, `VERK_NR`, `LFDNR`, `DATUM_ZEIT`, `LNR_CO` (→ `CHECKOUT`), `STORNO_KZ`, `SIGN_NICHT_OK` (TSE не підписано) | упевнено |
| `RECHNUNGSDRUCK` | 32 915 | Друкована форма: рядки з `GASTNAME`, `ZINR`, `VON`–`BIS`, `ME`, `EBETRAG`/`GBETRAG` — те, що видно на бланку | упевнено |
| `RE_NACHDRUCK` | 42 | Повторний друк з адресою на момент друку | упевнено |
| `RECHNUNG_INFO` | 178 | Примітки до фактури | упевнено |
| `CHECKOUT` | 31 012 | Подія чек-ауту: `RECHNR`, `RE_LAUF`, користувач, час. `LNR_CO` в інших таблицях → сюди | упевнено |
| `FAKT_ERLOESE` | 88 637 | Виручка по проводках для FIBU: дата, послуга, сума, `ST_SCHL` (код ПДВ), `STEUERSATZ` (ставка числом), `KONTO_NR`, `RECHNR`, `ADR_LNR`, `ZAHLUNGSART`, `DURCHL` | упевнено |
| `AUSGBUCH` | 65 396 | Книга вихідних рахунків (Ausgangsbuch): фактура × рядок, `UMSATZ`, `STEUERSATZ`, `KONTO_NR`, `DB_STATUS` (сплачено?) — **джерело для «offener Betrag» по дебіторах** | упевнено |
| `TAG_ABS` | 1 386 | Денні закриття (Tagesabschluss): лічильник, сальдо, `SIGN_ABSCHLUSS_OK` | упевнено |
| `FIBU_UEBER` | 171 | Експорти у бухгалтерію (DATEV): період, SQL, текст | упевнено |
| `TEMP_FIBU` | 691 | Буфер останнього експорту | упевнено |
| `KONTSTAM` | 51 | План рахунків (KONTONR, збірні рахунки, стиснення для FIBU) | упевнено |
| `REDRUCK_STEUER`, `ABSCHLUESSE`, `TEMP_FIBU_KOMP`, `TEMP_FIBU_TG_ABS` | 0 | ПДВ-рекапітуляція окремою таблицею — **порожня**; рекапітуляція рахується з рядків | гіпотеза |

## F. Оплати і каса

| Таблиця | Рядків | Що це | Упевненість |
|---|---|---|---|
| `ZAHLUNGEN` | 26 115 | Платежі: `LNR_DEVI → DEVISEN` (спосіб), `BETRAG`, `BUDAT`, `LNR_GK` (рахунок гостя), `GASTNR_1` (адреса), `RE_NR` (фактура), `M_DEBITOR` (дебіторський), `MAHNS` (нагадування), `TG_ABS`, `SIGNATUR_OK`, `GS_EXTERN_*` (зовнішній ваучер) | упевнено |
| `ZAHLUNG_ZUS` | 3 286 | Погашення дебіторських платежів: `LNR_ZA`, дата, `EINREICH_LNR` | гіпотеза |
| `DEVISEN` | 24 | **Способи оплати** («Devisen» історично валюти): `KURZBEZ`, `BEZEICHN`, `KURS_FAKT`, `M_DEPITOR` (дебітор), `KONTONR`, `ZAHLUNGSART`, `ZVT_AKTIV` (EC-термінал), `FISKAL_GES_VORF` | упевнено |
| `KASSEN` | 206 | Касові проводки поза рахунком гостя (Kassenbuch: витрати, приватні внески, транзит) — колонки як `FAKT_ERLOESE` + `ZAHLUNGSART`, `GASTNR` | упевнено |
| `KASSVORTRAG` | 1 | Початкове сальдо каси | упевнено |
| `KELLNER` | 1 | Офіціант/касир | упевнено |
| `KELL_UMSATZ`, `REGKAS_DETAIL`, `REGKAS_KD_RECH`, `REGKAS_KD_RECH_POS`, `REGKAS_UMSATZ`, `REGKAS_UMSATZ_TEMP`, `REGKAS_ZA`, `REGKAS_ZA_TEMP` | 0 | Інтерфейс касової системи ресторану — не використовується | гіпотеза |

## G. Фіскалізація (TSE)

| Таблиця | Рядків | Що це | Упевненість |
|---|---|---|---|
| `MANDANT_FISKAL` | 1 | Конфігурація TSE: `URL`, `CASHBOX_ID`, `QUEUE_ID`, `SCU_ID`, `TSE_SER_NUM`, `PUBLIC_KEY`, `CERTIFICATE`, `REC_TYPE`, `KASSENSERIENNUMMER`, XML активації/деактивації — словник fiskaltrust | упевнено |
| `FISKAL_BK` | 79 610 | Копія кожного рядка рахунку на момент фіскалізації + `SIGNATUR`, `GEGEN_SIGNATUR`, `FISKAL_REF`, `SIGN_OK`, `ANZAHL_VERSUCHE` (тригери `BUCHKONT_AI_FISKAL`/`BUCHKONT_FISKAL` при `TA_STATUS` 399–599) | упевнено |
| `TEMP_FISKAL_BK` | 85 987 | Буфер відправки в TSE (`START_REF`, `FISKAL_REF`) | упевнено |
| `FISKAL_RECHNUNG` | 12 837 | Фіскальна квитанція на фактуру: `REC_REF`, `REC_ID`, `REC_STATE`, `CASHBOXID`, `QUEUE_ID`, 16 пар `SIGNn_CAPTION/DATA` (рядки підпису на чеку) | упевнено |
| `FISKAL_RECH_POS` | 42 509 | Позиції фіскальної квитанції з `STSATZ` | упевнено |
| `FISKAL_ZERO_REC` | 3 607 | Нульові квитанції (start/stop receipts, денні) | упевнено |
| `ATRUST_SIGN_EINHEIT` | 0 | Австрійська RKSV (a-trust) — не для DE | упевнено |

## H. Ціни, знижки, політики, ваучери

| Таблиця | Рядків | Що це | Упевненість |
|---|---|---|---|
| `PREISCODE` | 10 | Прайс-коди (Standard, Pauschalen, Firmenpreise, Booking.com, HRS, VPW, Wanderreisen, WEB.MX, 2 корпоративні) | упевнено |
| `SAISSTAM` | 23 | Сезони на прайс-код: `PRCODE`, `SAISON` (номер), `VON`–`BIS`, `BEMERK` (HS/NS), дні тижня, `NUR_WE_PR` | упевнено |
| `PREISLIST` | 341 | Цінові рядки: прайс-код × прайс-лист категорії × сезон × `MATCHC` (ÜF_1..4 = осіб; FA_* фірмові) → `BETRAG` за ніч, `EZPREIS`, `MIN_TAGE`/`MAX_TAGE`, `KURTAX_INKL`, `ONLINE_BUCHBAR`, `FM_RATEID` (rate id в channel manager), `LEIST_LNR` (1 Logis / 78 Logis Firmen) | упевнено |
| `PREISSPLITTING` | 455 | Розкладка цінового рядка на послуги (Logis / сніданок …) з ПДВ — **звідси ПДВ-спліт на фактурі** (FK → `PREISLIST`) | упевнено |
| `PREISLIST_VERERB` | 168 | Успадкування цін: похідний `MATCHC` від базового з надбавкою (`AUFSCHLAG_*`) | упевнено |
| `PREISLIST_FREIM` | 398 | Які цінові рядки передавати провайдеру (тригер `PREISLIST_BU10`) | упевнено |
| `RABATT` | 1 | Правило знижки: прайс-код/послуга/період/дні тижня/% | упевнено |
| `TEMPLATE_PREISOPTION` | 2 | Обмеження заїзду по днях тижня, min stay для веб | упевнено |
| `MXTEMPLATE` | 2 | Шаблони (для сплітів/пакетів) | гіпотеза |
| `SARA_ASSISENT`, `SARA_ASSISENT_DEF` | 1, 1 | «Асистент» yield/автоцін (SARA) — період, активність | гіпотеза |
| `ARCHIV_PREISLIST` 4 512, `ARCHIV_PREISSPLITTING` 1 412, `ARCHIV_PREISLIST_VERERB` 210, `ARCHIV_STEUSTAM` 18 | | Архіви цін і ставок ПДВ (тригери before update) — історія по роках | упевнено |
| `STORNO_BED` | 0 | Умови сторно (дні до заїзду → %/сума) — **порожня**; політики в базі не ведуться | упевнено |
| `GUTSCHEINE`, `GUTSCHEIN_MOTIVE`, `GUTSCHEIN_PAKETE`, `PARAMETE_GUTSCHEIN` | 0 | Модуль ваучерів — **порожній**; ваучери проходять як послуги `GUTSCHEIN`/`GS`/`GSS` у `BUCHKONT` | упевнено |
| `PRCODE_RABATT`, `SAISNACHLASS`, `GLOB_SPLITTING`, `PREISLIST_ADDON`, `PREISLIST_BARRATE`, `PREISLIST_BASIS`, `PREISLIST_CALC`, `PREISLIST_MATCHC`, `PREISLIST_TGPREIS`, `PREISLIST_VERERB_FREIM`, `ARCHIV_PREISLIST_TGPREIS`, `PREIS_VERR_LEISTUNG` | 0 | Порожні варіанти ціноутворення | гіпотеза |

## I. Канали і веб-бронювання

| Таблиця | Рядків | Що це | Упевненість |
|---|---|---|---|
| `FREIMELD_PRO` | 2 | Провайдери channel manager: URL, логін, `APIKEY`, ~100 прапорців поведінки | упевнено |
| `FREIMELD_KATE` | 45 | Мапа категорія ↔ зовнішня (`KATE_EXTERN`, `PR_ID`, `PACK_ID`…), ліміти | упевнено |
| `WEB_ABF_TEMP` | 53 735 | Сесії запитів веб-бронювання (WEB.MX): категорія, вільно, ціна | упевнено |
| `WEB_ABF_TEMP_LOGI` | 53 702 | Рядки Logis на сесію | упевнено |
| `WEB_ABF_TEMP_ZL` | 18 174 | Додаткові послуги на сесію | упевнено |
| `STAT_WEB_ABF` | 33 897 | Воронка веб-бронювання по кроках | упевнено |
| `PARAMETE_WEB`, `PARAMETE_ONL_BUCH` | 1, 1 | Налаштування веб-модуля (SMTP, платіжний шлюз, поля форми) — **містять паролі** | упевнено |
| `VERBINDUNGEN_WS` | 2 | Робочі станції: TAPI, EC-термінал, ALWA-card | упевнено |
| `FREIMELD_KATE_PRL`, `FREIMELD_KATE_REST`, `FREIMELD_REST_CON`, `FREIMELD_VAKANZ`, `WEB_ABF_TEMP_USER`, `WEB_ABF_GS`, `PARAMETE_WEB_BILDLINK` | 0 | Порожні | гіпотеза |

## J. Статистика (похідне, не імпортується)

| Таблиця | Рядків | Що це |
|---|---|---|
| `STAT_UMSATZ` | 127 738 | Виручка по днях/послугах (заповнюється при закритті дня) |
| `STAT_BELEGUNG` | 38 176 | Заселеність по днях (дорослі/діти/підлітки) |
| `TEMP_STAT_UMS_DASHBOARD` 3 737, `TEMP_STAT_AUSW` 3 121, `TEMP_STAT_MANAG` 2 777, `TEMP_STAT_UMSATZ` 19, `TEMP_VORS_BELEG` 36 | | Буфери звітів |
| `STAT_BELEG_BUDGET`, `STAT_UMSATZ_FIBU`, `TEMP_STAT_BELEG_UMSATZ`, `TEMP_STAT_MANAG_TGABS`, `TEMP_STAT_UMS_BELEG`, `TEMP_STAT_ZUSATZ` | 0 | |

## K. Журнали дій

| Таблиця | Рядків | Що це |
|---|---|---|
| `ANWENDER_PROT` | 206 741 | Аудит користувача: таблиця × рядок × дія × хто/коли (тригери `*_AP`) |
| `USERPROT` | 60 214 | Старіший журнал: програма, дія, `GASTNR`, `BELEGNR`, сума |
| `TEMP_TODO_NACHRICHTEN` | 43 998 | Повідомлення/нагадування користувачам (з іменами гостей — персональні дані) |
| `TEMP_POSTAUSGANG` | 1 | Черга вихідної пошти |
| `ADR_TELE_PROT`, `ZIMMERSTATUS_PROT`, `ZUTRITTSKONTROLLE_PROT`, `POSTAUSGANG` | 0 | |

## L. Тексти, шаблони, користувачі, параметри

| Таблиця | Рядків | Що це |
|---|---|---|
| `TEXTE` | 691 | Текстові блоки (листи, підтвердження) за мовою і областю |
| `SPRACHE`, `SPRACHE_TEXTE` | 2, 11 | Мови і переклади полів |
| `VORLAGEN` | 21 | Шаблони друку (дизайнер звітів) |
| `LISTEN` | 47 | Реєстр списків/звітів і принтерів |
| `TEMPDRUCKEN` | 29 | Буфер друку |
| `BEDIENER`, `BEDIENER_GRU` | 21, 1 | Користувачі (з `PASSWORT`) і групи прав |
| `PARAMETE`, `PARAM_INTERN`, `PARAM_LIZENZ`, `PARAM_PFLICH_FELDER`, `PARAMETE_SQL`, `SYS_STADA_GLOBAL` | 1, 1, 1, 1, 4, 2 | Параметри програми, ліцензія (модулі: housekeeping, wellness, FIBU…), обов'язкові поля, збережені SQL |
| `THERAPEUT` | 1 | Терапевт wellness (один тестовий) |
| `TEXTSTAM`, `ZUSATZ_TEXT`, `GASTKZUS_TEXT`, `TEMP_DRUCK_ZIM_ABRECH`, `TEMP_ZEITDRUCK`, `TEMP_QRCODE`, `TEMP_ZIM_ABRECH`, `TEMP_VAKANZ`, `PARAM_APP`, `PARAM_HOUSEKEEP`, `PARAM_INTERFACE`, `PARAM_INTERFACE_TM`, `PARAM_LAGEPLAN`, `PARAM_NACHRICHT`, `PARAM_PLAN`, `PARAMETE_APP`, `ABLAGEDIVERS`, `DATENERFPORT` | 0 | |

## M. Модулі, яких готель не використовує (усі 0 рядків)

Housekeeping: `HOUSEKEEPING`, `REINIGUNG`, `WAESCHEWECHSEL`, `ZIMMERSELEKT`, `FUNDBUERO`.
Ресторан/столи: `TISCHBELEGUNG`, `TISCHBELEGUNG_NOTIZ`, `TISCHBELEGUNG_SCHICHT`, `TISCHPLAN`,
`TISCHUMS`, `ARCHIV_TISCHBELEGUNG`, `BOUGSTAM`. Wellness/курси: `KURS`, `KURSTEILNEHMER`,
`KURSTEILNEHMER_ZUSATZ`, `THERAPEUT_ANW`. Термінали/бронювання ресурсів: `TERMINE`, `TERMINE_BK`,
`TERM_NOTIZ`, `TERM_VERLAUF`, `ARCHIV_TERMINE`. Власники апартаментів (Eigentümer): `EIGT_ABR_LFD`,
`EIGT_BELAST_ZUSATZ`, `EIGT_ERWEIT`, `EIGT_KTO`. Персонал: `MITARBEITER`, `MITARBEITER_ADR`,
`MITARB_ZEITERF`. Телефонія: `TELEFON`, `TELEFNEBENST`. Інше: `ENERG_STEUERUNG`, `SHUTTLE`,
`KARTEI_VERK_STAMM`, `GASTKZAREF`.

## Порожні таблиці — одним списком

139 із 258 таблиць мають 0 рядків. Крім названих у розділах вище, це технічні буфери
`TEMP_*` і модулі, які в цій інсталяції ніколи не вмикались. Для імпортера це означає:
**жодна з них не є джерелом**, і зокрема — умови сторно (`STORNO_BED`), ваучери
(`GUTSCHEINE`), Meldeschein-дані (`MELDEDATEN`), курортний збір як довідник (`KURTSTAM`)
і housekeeping існують у Winhotel лише як функція, якою не користувались, або живуть у
інших таблицях (див. `MAPPING.md`).

Повна відповідність «таблиця → рядків» для всіх 258 — у `extract-out/main/table-counts.tsv`;
цей документ групує, не заміняє.

## WHMXVAKANZ.fbk (окрема база channel manager)

5 таблиць: `FM_PROT` 486 (журнал обміну з провайдером: лічильники відправлено/отримано,
`PROTOKOLL` BLOB), `FREIMELD_PREISLIST` 0, `FREIMELD_VAKANZ` 0, `HIS_PROT` 0,
`TEMP_RATEBOARD` 0. Для міграції неістотна: наявність ми рахуємо з броней.

## WHMXDOKUMENT.FDB

3 порожні таблиці (`DOKUMENT`, `DOKUMENT_MS`, `DOKUMENT_WEB`) — див. `DDL-WHMXDOKUMENT.sql`;
документи готелю лежать у головній базі в `DOKUMENT` (17 542).
