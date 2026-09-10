-- entity: units
-- source: ZIMMSTAM
-- columns: lnr:int, mand_nr:int, zinr:text, lnr_kate:int, bezeichn:text, ausstatung:text, gesperrt:bool, gesp_von:date, gesp_bis:date, bettzahl:int, preislist:int, stock:int, vermietjn:bool, zimmerart:int, online_verfugbar:bool, anz_erw:int, anz_gesapers:int, clean_st:int, flaeche:amount, bemerk1:text
--
-- Дельта (задача 8 §3): довідник береться цілком — він малий, а імпорт звіряє його щоразу.
-- Рядок `-- columns:` МУСИТЬ збігатися з apps/winhotel-import/sql/<сутність>.sql: міст розбирає вивід за ним.
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
