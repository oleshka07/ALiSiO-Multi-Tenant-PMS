-- entity: services
-- source: LEISTSTA
-- deleted: kept — історичні рядки рахунків посилаються й на вимкнені послуги — застосунок їх упізнає, не створює
-- columns: lnr:int, mand_nr:int, leist_lnr:int, kurzbez:text, bezeichn:text, hg:int, wg:int, sts:int, betrag:amount, kontonr:text, bemerkung:text, m_fix:bool, m_logi:bool, m_leist:bool, aufp:int, ta_status:int, sort_nr:int, pr_code:int, fm_rate:text, web_verf:bool
--
-- Послуги (крок 4). БЕЗ фільтра TA_STATUS навмисно: історичні рядки рахунків посилаються й на вимкнені
-- послуги, і застосунок мусить знати їхній рід (WG) — вимкнені він не створює, він їх упізнає (IMPORT-PLAN §2.4).
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
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
