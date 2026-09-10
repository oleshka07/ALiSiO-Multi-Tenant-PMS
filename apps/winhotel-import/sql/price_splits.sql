-- entity: price_splits
-- source: PREISSPLITTING
-- columns: lnr:int, preislist_lnr:int, leistung_lnr:int, betrag:amount, menge:int, taeglich:bool, properson:bool, betrag_proz:bool, brutto_netto:int, proz_vom_reduz_betr:int, sort_nr:int
--
-- Спліт ціни на послуги (Logis + сніданок) — для звірки з нашим splitOtaAmount(), не для даних.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PREISLIST_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LEISTUNG_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MENGE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TAEGLICH AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PROPERSON AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BETRAG_PROZ AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BRUTTO_NETTO AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PROZ_VOM_REDUZ_BETR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SORT_NR AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM PREISSPLITTING
WHERE TA_STATUS < 1000;
