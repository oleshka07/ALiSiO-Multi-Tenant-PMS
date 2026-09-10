-- entity: payment_methods
-- source: DEVISEN
-- deleted: kept — історичні платежі посилаються й на вимкнені способи
-- columns: lnr:int, mand_nr:int, kurzbez:text, bezeichn:text, kurs_fakt:amount, zahlungsart:int, m_depitor:bool, m_debirechn:bool, m_op_mahn:bool, kontonr:text, wg:int, aktive:bool, ta_status:int, zvt_aktiv:bool, gastauslage:bool, sort_nr:int
--
-- Способи оплати (крок 12): 24 рядки → наші чотири класи; без фільтра — історичні платежі посилаються й на вимкнені.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(KURZBEZ, '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(KURS_FAKT AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ZAHLUNGSART AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(M_DEPITOR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(M_DEBIRECHN AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(M_OP_MAHN AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(KONTONR, '') || ASCII_CHAR(31)
  || COALESCE(CAST(WG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(AKTIVE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TA_STATUS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ZVT_AKTIV AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GASTAUSLAGE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SORT_NR AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM DEVISEN
WHERE 1 = 1;
