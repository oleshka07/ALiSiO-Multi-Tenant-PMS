-- entity: service_groups
-- source: WARENGRU
-- columns: lnr:int, mand_nr:int, wgnr:int, bezeichn:text, durchl:bool, ums_gr:int
--
-- Товарні групи послуг: WGNR (100 Logis, 200/300 сніданок їжа/напої, 600 durchlaufend, 700+ каса).
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(WGNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(DURCHL AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(UMS_GR AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM WARENGRU
WHERE TA_STATUS < 1000;
