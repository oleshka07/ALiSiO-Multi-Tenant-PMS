-- entity: tax_codes
-- source: STEUSTAM
-- columns: lnr:int, mand_nr:int, von:date, bis:date, sts:int, stsatz:amount, stland:text, stbemerk:text, fiskal_zuweisung:int, sts_kasse:text
--
-- Дельта (задача 8 §3): довідник береться цілком — він малий, а імпорт звіряє його щоразу.
-- Рядок `-- columns:` МУСИТЬ збігатися з apps/winhotel-import/sql/<сутність>.sql: міст розбирає вивід за ним.
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(VON AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BIS AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STSATZ AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(STLAND, '') || ASCII_CHAR(31)
  || COALESCE(STBEMERK, '') || ASCII_CHAR(31)
  || COALESCE(CAST(FISKAL_ZUWEISUNG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(STS_KASSE, '') || ASCII_CHAR(30)
FROM STEUSTAM
WHERE TA_STATUS < 1000;
