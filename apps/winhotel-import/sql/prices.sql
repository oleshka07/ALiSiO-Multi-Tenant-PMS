-- entity: prices
-- source: PREISLIST
-- columns: lnr:int, mand_nr:int, prcode_lnr:int, preistyp:int, preislist_lnr:int, saison:int, matchc:text, bezeichung:text, zimmerpreis:bool, pauschale:bool, von:date, bis:date, min_tage:int, max_tage:int, betrag:amount, leist_lnr:int, ezzuschlag:amount, ezpreis:amount, betrag_pers:int, kurtax_inkl:bool, fm_rateid:text, online_buchbar:bool, online_verfuegbar:bool, max_anz_erw:int, max_anz_kind:int, max_anz_gesamt:int, basis_lnr:int, prozentsatz:amount, ext_mapping:text
--
-- Цінові рядки (крок 5): MATCHC ÜF_1..ÜF_4 — заселеність 1–4; BETRAG за ніч ×1000; MIN_TAGE — LOS.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PRCODE_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PREISTYP AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PREISLIST_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SAISON AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(MATCHC, '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHUNG, '') || ASCII_CHAR(31)
  || COALESCE(CAST(ZIMMERPREIS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PAUSCHALE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(VON AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BIS AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MIN_TAGE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAX_TAGE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LEIST_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(EZZUSCHLAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(EZPREIS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BETRAG_PERS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(KURTAX_INKL AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(FM_RATEID, '') || ASCII_CHAR(31)
  || COALESCE(CAST(ONLINE_BUCHBAR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ONLINE_VERFUEGBAR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAX_ANZ_ERW AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAX_ANZ_KIND AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAX_ANZ_GESAMT AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BASIS_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PROZENTSATZ AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(EXT_MAPPING, '') || ASCII_CHAR(30)
FROM PREISLIST
WHERE TA_STATUS < 1000;
