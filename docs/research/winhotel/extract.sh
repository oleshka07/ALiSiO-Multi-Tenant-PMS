#!/usr/bin/env bash
# Витягання схеми і контрольних чисел з бази Winhotel.MX (Firebird 3, ODS 12.0).
#
# Це дослідницький інструмент, не код продукту: він живе в docs/research/winhotel/
# і ніколи не імпортується. Пише ЛИШЕ текст (DDL, лічильники, списки колонок).
# Рядків даних він не виводить, крім таблиць, названих у --sample явно — і це
# мають бути довідники без персональних даних (категорії, номери, послуги,
# ставки ПДВ, ціни, політики, джерела броні). Дивись REFERENCE-SAMPLES.md.
#
# Використання (у контейнері з firebird3.0-utils і firebird3.0-server):
#   docs/research/winhotel/extract.sh <WINHOTEL.fbk | WINHOTEL.FDB> <вихідна тека> [--sample T1,T2,...]
#
# .fbk відновлюється gbak-ом у /tmp/winhotel-extract/ (embedded, без сервера:
# пароль SYSDBA у цьому режимі не перевіряється — перевірено 09.09.2026 на
# WHMXDOKUMENT.fbk з навмисно неправильним паролем). .FDB відкривається напряму,
# якщо ODS = 12.x; старший ODS (11.x = Firebird 2.5) isql-fb відхилить — тоді
# лише .fbk. База після роботи ВИДАЛЯЄТЬСЯ (крок 6), і це треба сказати у звіті.
set -euo pipefail

SRC="${1:?джерело: .fbk або .FDB}"
OUT="${2:?вихідна тека}"
SAMPLE=""
if [ "${3:-}" = "--sample" ]; then SAMPLE="${4:-}"; fi

WORK=/tmp/winhotel-extract
mkdir -p "$WORK" "$OUT"
DB="$WORK/winhotel.fdb"

ISQL="isql-fb -user SYSDBA -q"

# 1. База: відновити з .fbk або скопіювати .FDB (isql відкриває файл на запис).
case "$SRC" in
  *.fbk|*.FBK)
    echo "== gbak -c $SRC -> $DB"
    rm -f "$DB"
    gbak -c -v "$SRC" "$DB" -user SYSDBA 2>&1 | tail -3
    ;;
  *)
    echo "== copy $SRC -> $DB"
    cp "$SRC" "$DB"
    ;;
esac

# 2. Версія/ODS/кодування — у header.txt.
$ISQL "$DB" <<'SQL' > "$OUT/header.txt" 2>&1
SHOW VERSION;
SHOW DATABASE;
SQL
grep -E "ODS|Character|Creation|PAGE_SIZE|Firebird" "$OUT/header.txt" || true

# 3. Повний DDL — як є, без правок.
echo "== DDL"
isql-fb -user SYSDBA -x "$DB" > "$OUT/DDL.sql" 2> "$OUT/DDL.err" || true
if [ -s "$OUT/DDL.err" ]; then echo "DDL.err не порожній:"; head -5 "$OUT/DDL.err"; fi
echo "CREATE TABLE: $(grep -c '^CREATE TABLE' "$OUT/DDL.sql" || true)"

# 4. Список таблиць (без системних і без view) → по одному COUNT(*) на таблицю.
echo "== counts"
$ISQL "$DB" <<'SQL' 2>/dev/null | sed 's/[[:space:]]*$//' | grep -vE '^(RDB\$RELATION_NAME|=+)?$' > "$WORK/tables.txt"
SET HEADING OFF;
SELECT TRIM(RDB$RELATION_NAME) FROM RDB$RELATIONS
 WHERE RDB$SYSTEM_FLAG = 0 AND RDB$VIEW_BLR IS NULL
 ORDER BY 1;
SQL
sed -i 's/^[[:space:]]*//' "$WORK/tables.txt"
echo "таблиць: $(wc -l < "$WORK/tables.txt")"

: > "$OUT/table-counts.tsv"
while read -r T; do
  [ -z "$T" ] && continue
  N=$($ISQL "$DB" <<SQL 2>/dev/null | tr -d ' \n' || true
SET HEADING OFF;
SELECT COUNT(*) FROM "$T";
SQL
)
  printf '%s\t%s\n' "$T" "${N:-ERR}" >> "$OUT/table-counts.tsv"
done < "$WORK/tables.txt"
sort -t$'\t' -k2,2nr "$OUT/table-counts.tsv" > "$OUT/table-counts.by-size.tsv"

# 5. Колонки кожної таблиці одним файлом — для пошуку за назвами
#    (BELEG, VERKN, GAST, ADR, RECHN, ZAHL, ZIMMER, KAT, LEIST, PREIS, SAISON,
#    STORNO, GUTSCHEIN, MWST, UST, TSE, DEBITOR, ANZAHL, SEGM, REFERENZ).
echo "== columns"
$ISQL "$DB" <<'SQL' 2>/dev/null > "$OUT/table-columns.tsv"
SET HEADING OFF;
SELECT TRIM(rf.RDB$RELATION_NAME) || '.' || TRIM(rf.RDB$FIELD_NAME) || '  ' ||
       CASE f.RDB$FIELD_TYPE
         WHEN 7 THEN 'SMALLINT' WHEN 8 THEN 'INTEGER' WHEN 16 THEN 'BIGINT'
         WHEN 10 THEN 'FLOAT' WHEN 27 THEN 'DOUBLE' WHEN 12 THEN 'DATE'
         WHEN 13 THEN 'TIME' WHEN 35 THEN 'TIMESTAMP' WHEN 14 THEN 'CHAR'
         WHEN 37 THEN 'VARCHAR' WHEN 261 THEN 'BLOB' ELSE 'T' || f.RDB$FIELD_TYPE END
       || COALESCE('(' || f.RDB$CHARACTER_LENGTH || ')', '')
  FROM RDB$RELATION_FIELDS rf
  JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
  JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
 WHERE r.RDB$SYSTEM_FLAG = 0
 ORDER BY rf.RDB$RELATION_NAME, rf.RDB$FIELD_POSITION;
SQL
sed -i 's/^[[:space:]]*//; s/[[:space:]]*$//; /^$/d' "$OUT/table-columns.tsv"

echo "== keyword hits (назви таблиць і колонок, не дані)"
grep -iE 'BELEG|VERKN|GAST|ADR|RECHN|ZAHL|ZIMMER|KAT|LEIST|PREIS|SAISON|STORNO|GUTSCHEIN|MWST|UST|TSE|DEBITOR|ANZAHL|SEGM|REFERENZ|PUBLIC|SIGNATUR|SERIAL' \
  "$OUT/table-columns.tsv" > "$OUT/keyword-hits.txt" || true
wc -l "$OUT/keyword-hits.txt"

# 6. Зразки — лише для явно названих довідників, по 10 рядків.
if [ -n "$SAMPLE" ]; then
  echo "== samples: $SAMPLE"
  : > "$OUT/samples.txt"
  IFS=',' read -ra TS <<< "$SAMPLE"
  for T in "${TS[@]}"; do
    {
      echo "-- $T"
      $ISQL "$DB" <<SQL 2>&1
SELECT FIRST 10 * FROM "$T";
SQL
      echo
    } >> "$OUT/samples.txt"
  done
fi

# 7. Прибрати базу з контейнера. Джерело ($SRC) лишається на совісті того,
#    хто його поклав, — видаліть і його, коли закінчите.
rm -f "$DB"
echo "== база $DB видалена; результати в $OUT"
