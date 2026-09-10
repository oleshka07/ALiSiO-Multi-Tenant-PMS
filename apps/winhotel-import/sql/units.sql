-- entity: units
-- source: ZIMMSTAM
-- columns: lnr:int, mand_nr:int, zinr:text, lnr_kate:int, bezeichn:text, ausstatung:text, gesperrt:bool, gesp_von:date, gesp_bis:date, bettzahl:int, preislist:int, stock:int, vermietjn:bool, zimmerart:int, online_verfugbar:bool, anz_erw:int, anz_gesapers:int, clean_st:int, flaeche:amount, bemerk1:text
--
-- Номери (крок 3): ZINR — код; ZINR >= 9000 / STOCK = 99 — псевдо-номери, застосунок їх не створює.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(ZINR, '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_KATE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(AUSSTATUNG, '') || ASCII_CHAR(31)
  || COALESCE(CAST(GESPERRT AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GESP_VON AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GESP_BIS AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BETTZAHL AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PREISLIST AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STOCK AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(VERMIETJN AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ZIMMERART AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ONLINE_VERFUGBAR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZ_ERW AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZ_GESAPERS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(CLEAN_ST AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(FLAECHE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEMERK1, '') || ASCII_CHAR(30)
FROM ZIMMSTAM
WHERE TA_STATUS < 1000 AND ZINR IS NOT NULL;
