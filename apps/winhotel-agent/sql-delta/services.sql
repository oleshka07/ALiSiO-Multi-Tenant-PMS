-- entity: services
-- source: LEISTSTA
-- columns: lnr:int, mand_nr:int, leist_lnr:int, kurzbez:text, bezeichn:text, hg:int, wg:int, sts:int, betrag:amount, kontonr:text, bemerkung:text, m_fix:bool, m_logi:bool, m_leist:bool, aufp:int, ta_status:int, sort_nr:int, pr_code:int, fm_rate:text, web_verf:bool
--
-- Дельта (задача 8 §3): довідник береться цілком — він малий, а імпорт звіряє його щоразу.
-- Рядок `-- columns:` МУСИТЬ збігатися з apps/winhotel-import/sql/<сутність>.sql: міст розбирає вивід за ним.
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LEIST_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(KURZBEZ, '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(HG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(WG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(KONTONR, '') || ASCII_CHAR(31)
  || COALESCE(BEMERKUNG, '') || ASCII_CHAR(31)
  || COALESCE(CAST(M_FIX AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(M_LOGI AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(M_LEIST AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(AUFP AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TA_STATUS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SORT_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PR_CODE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(FM_RATE, '') || ASCII_CHAR(31)
  || COALESCE(CAST(WEB_VERF AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM LEISTSTA
WHERE 1 = 1;
