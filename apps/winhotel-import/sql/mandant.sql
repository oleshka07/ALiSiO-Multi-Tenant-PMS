-- entity: mandant
-- source: MANDANT
-- columns: lnr:int, bezeichn:text, name1:text, name2:text, name3:text, strasse:text, ort:text, telefon:text, e_mail:text, land_iso:text, betriebnr:text, rechnr:int, rechnr_vorspann:text, quit_nr:int, default_debinr:text, lfddebitor:float, anzahlung_leist_lnr:int, anzahlung_nach_steuer:int, fiskal_aktive:int, post_land:int
--
-- Обʼєкт (крок 1 плану): лише звірка назви й адреси; лічильник фактур і префікс — контрольні числа.
-- Паролі FIBU/VA/ALWA/BS і ключі API навмисно не вибираються.
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BEZEICHN, '') || ASCII_CHAR(31)
  || COALESCE(NAME1, '') || ASCII_CHAR(31)
  || COALESCE(NAME2, '') || ASCII_CHAR(31)
  || COALESCE(NAME3, '') || ASCII_CHAR(31)
  || COALESCE(STRASSE, '') || ASCII_CHAR(31)
  || COALESCE(ORT, '') || ASCII_CHAR(31)
  || COALESCE(TELEFON, '') || ASCII_CHAR(31)
  || COALESCE(E_MAIL, '') || ASCII_CHAR(31)
  || COALESCE(LAND_ISO, '') || ASCII_CHAR(31)
  || COALESCE(BETRIEBNR, '') || ASCII_CHAR(31)
  || COALESCE(CAST(RECHNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(RECHNR_VORSPANN, '') || ASCII_CHAR(31)
  || COALESCE(CAST(QUIT_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(DEFAULT_DEBINR, '') || ASCII_CHAR(31)
  || COALESCE(CAST(LFDDEBITOR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZAHLUNG_LEIST_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZAHLUNG_NACH_STEUER AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(FISKAL_AKTIVE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(POST_LAND AS VARCHAR(30)), '') || ASCII_CHAR(30)
FROM MANDANT
WHERE TA_STATUS < 1000;
