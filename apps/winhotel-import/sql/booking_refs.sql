-- entity: booking_refs
-- source: GASTKREF
-- columns: lnr:int, gk_lnr:int, ref_nr:text, inet_ref_nr:text, ext_source:text, ext_refnr:text, ref_storno:text, precheckin_done:bool, erf_datumzeit:ts, text1:text, text2:text, text3:text, text4:text, text5:text
--
-- Референси броней: номер OTA (REF_NR / EXT_REFNR), джерело, сторно-референс.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GK_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(REF_NR, '') || ASCII_CHAR(31)
  || COALESCE(INET_REF_NR, '') || ASCII_CHAR(31)
  || COALESCE(EXT_SOURCE, '') || ASCII_CHAR(31)
  || COALESCE(EXT_REFNR, '') || ASCII_CHAR(31)
  || COALESCE(REF_STORNO, '') || ASCII_CHAR(31)
  || COALESCE(CAST(PRECHECKIN_DONE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ERF_DATUMZEIT AS VARCHAR(24)), '') || ASCII_CHAR(31)
  || COALESCE(TEXT1, '') || ASCII_CHAR(31)
  || COALESCE(TEXT2, '') || ASCII_CHAR(31)
  || COALESCE(TEXT3, '') || ASCII_CHAR(31)
  || COALESCE(TEXT4, '') || ASCII_CHAR(31)
  || COALESCE(TEXT5, '') || ASCII_CHAR(30)
FROM GASTKREF
WHERE TA_STATUS < 1000;
