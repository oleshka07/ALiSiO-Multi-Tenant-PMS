-- entity: segments
-- source: SEGMSTAM
-- columns: lnr:int, mand_nr:int, segmcode:int, bezeichn:text, sort_lnr:int, leistung_lnr:int, prozent_betrag:int, betrag:amount
--
-- Дельта (задача 8 §3): довідник береться цілком — він малий, а імпорт звіряє його щоразу.
-- Рядок `-- columns:` МУСИТЬ збігатися з apps/winhotel-import/sql/<сутність>.sql: міст розбирає вивід за ним.
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SEGMCODE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(SORT_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LEISTUNG_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PROZENT_BETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BETRAG AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM SEGMSTAM
WHERE TA_STATUS < 1000;
