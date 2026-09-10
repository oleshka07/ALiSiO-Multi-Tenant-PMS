-- entity: cash_book
-- source: KASSEN
-- columns: lnr:int, mand_nr:int, budat:date, belegnr:int, lnr_leist:int, kurzbez:text, bezeichn:text, betrag:amount, kontonr:text, st_schl:int, rechnr:int, zahlungsart:int, manuell:int, gastnr:int, woher:int, durchl:bool, tag_abs_lnr:int, steuersatz:amount
--
-- Касова книга поза рахунками гостей (крок 12): витрати, приватні внески, транзит каса→банк.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BUDAT AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BELEGNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_LEIST AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(KURZBEZ, '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(BETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(KONTONR, '') || ASCII_CHAR(31)
  || COALESCE(CAST(ST_SCHL AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RECHNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ZAHLUNGSART AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MANUELL AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GASTNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(WOHER AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(DURCHL AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TAG_ABS_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STEUERSATZ AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM KASSEN
WHERE TA_STATUS < 1000;
