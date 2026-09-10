-- entity: unit_types
-- source: KATESTAM
-- columns: lnr:int, mand_nr:int, kategorie:text, bemerk1:text, bemerk2:text, anz_kate:int, preislist:int, pseudo:bool, anz_betten:int, anz_erw:int, anz_erw_min:int, anz_jug:int, anz_k1:int, anz_k2:int, anz_gesapers:int, online_verfugbar:bool, sort_nr:int, kate_mappng:text, fewo:bool, haustier:int, raucher:int
--
-- Категорії (крок 3): PSEUDO = 1 — псевдо (семінар, сховище броней без номера), імпорт їх не створює.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(KATEGORIE, '') || ASCII_CHAR(31)
  || COALESCE(BEMERK1, '') || ASCII_CHAR(31)
  || COALESCE(BEMERK2, '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZ_KATE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PREISLIST AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PSEUDO AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZ_BETTEN AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZ_ERW AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZ_ERW_MIN AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZ_JUG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZ_K1 AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZ_K2 AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZ_GESAPERS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ONLINE_VERFUGBAR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SORT_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(KATE_MAPPNG, '') || ASCII_CHAR(31)
  || COALESCE(CAST(FEWO AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(HAUSTIER AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RAUCHER AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM KATESTAM
WHERE TA_STATUS < 1000 AND LNR NOT IN (0, 99999);
