-- entity: bookings
-- source: GASTKONT
-- columns: lnr:int, mand_nr:int, vonaufh:date, bisaufh:date, auftage:int, lnr_kate:int, lnr_zinr:int, resv_kate_lnr:int, umzug_zinr:text, gastnr_1:int, gastnr_2:int, gastnr_3:int, perszahl:int, anzkinder:int, anzkinder2:int, anzkleinkind:int, anzjugend:int, begleitok:bool, kind1ok:bool, kind2ok:bool, kind3ok:bool, kind4ok:bool, kind5ok:bool, buch_status:int, bu_st_option:int, res_option2:int, ci_status:int, ta_status:int, storno_datum:date, verk_nr:int, party_nr:int, share_nr:int, pr_code:int, tarif:int, markseg:int, ang_lnr:int, anza_betrag:amount, anza_datum:date, belgeit_als_re_empf:bool, bestellt_durch:text, bemerk:text, notiz:text, reisezweck:int, nachricht_erwuenscht:int, greenoptions:int, kontingent:int, status1:int, status2:int, belegungsart:int, abr_typ:int, reg_mode:int, gast_gr:int, resvbdat:date, erf_datum:date, kor_datum:date
--
-- Брони (крок 9): живі + сторновані з датою сторно (стають cancelled, IMPORT-PLAN §2.8); решта TA_STATUS >= 1000 — ні.
-- Дати — звідси, не з BELEGUNG (там сміття 1899-12-30).
--
-- Формат: поля через ASCII 31, запис закінчується ASCII 30 (deploy/bridge/lib/convert.mjs).
-- Запускається так само рукою: isql-fb -q -user SYSDBA -charset NONE -i <цей файл> <db.fdb>
SET HEADING OFF;
SELECT
     COALESCE(CAST(LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MAND_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(VONAUFH AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BISAUFH AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(AUFTAGE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_KATE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(LNR_ZINR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RESV_KATE_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(UMZUG_ZINR, '') || ASCII_CHAR(31)
  || COALESCE(CAST(GASTNR_1 AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GASTNR_2 AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GASTNR_3 AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PERSZAHL AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZKINDER AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZKINDER2 AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZKLEINKIND AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZJUGEND AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BEGLEITOK AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(KIND1OK AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(KIND2OK AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(KIND3OK AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(KIND4OK AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(KIND5OK AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BUCH_STATUS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BU_ST_OPTION AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RES_OPTION2 AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(CI_STATUS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TA_STATUS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STORNO_DATUM AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(VERK_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PARTY_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(SHARE_NR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(PR_CODE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(TARIF AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(MARKSEG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANG_LNR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZA_BETRAG AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ANZA_DATUM AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BELGEIT_ALS_RE_EMPF AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(BESTELLT_DURCH, '') || ASCII_CHAR(31)
  || COALESCE(BEMERK, '') || ASCII_CHAR(31)
  || COALESCE(NOTIZ, '') || ASCII_CHAR(31)
  || COALESCE(CAST(REISEZWECK AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(NACHRICHT_ERWUENSCHT AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GREENOPTIONS AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(KONTINGENT AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STATUS1 AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(STATUS2 AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(BELEGUNGSART AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ABR_TYP AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(REG_MODE AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(GAST_GR AS VARCHAR(30)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(RESVBDAT AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(ERF_DATUM AS VARCHAR(10)), '') || ASCII_CHAR(31)
  || COALESCE(CAST(KOR_DATUM AS VARCHAR(10)), '') || ASCII_CHAR(30)
FROM GASTKONT
WHERE TA_STATUS < 1000 OR STORNO_DATUM IS NOT NULL;
