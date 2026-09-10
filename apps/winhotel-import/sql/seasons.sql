-- entity: seasons
-- source: SAISSTAM
-- columns: lnr:int, mand_nr:int, prcode:int, saison:int, von:date, bis:date, bemerk:text, wo_mo:bool, wo_di:bool, wo_mi:bool, wo_do:bool, wo_fr:bool, wo_sa:bool, wo_so:bool, nur_we_pr:bool, objekt_nr:int
--
-- Сезони (крок 5): PRCODE — прайс-код, SAISON — спільний ключ із PREISLIST.SAISON, VON–BIS включно.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PRCODE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SAISON AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(VON AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BIS AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(BEMERK, '') || ASCII_CHAR(31)
  || COALESCE(CAST(WO_MO AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(WO_DI AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(WO_MI AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(WO_DO AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(WO_FR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(WO_SA AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(WO_SO AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(NUR_WE_PR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(OBJEKT_NR AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM SAISSTAM
WHERE TA_STATUS < 1000;
