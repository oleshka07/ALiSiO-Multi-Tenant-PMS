-- entity: service_groups
-- source: WARENGRU
-- columns: lnr:int, mand_nr:int, wgnr:int, bezeichn:text, durchl:bool, ums_gr:int
--
-- Дельта (задача 8 §3): довідник береться цілком — він малий, а імпорт звіряє його щоразу.
-- Рядок `-- columns:` МУСИТЬ збігатися з apps/winhotel-import/sql/<сутність>.sql: міст розбирає вивід за ним.
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
