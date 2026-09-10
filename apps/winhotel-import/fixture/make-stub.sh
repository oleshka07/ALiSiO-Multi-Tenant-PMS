#!/usr/bin/env bash
# Зібрати стаб-бекап Winhotel: stub-db.sql → .fdb (isql-fb, вбудований режим) → .fbk (gbak -b).
#
#   apps/winhotel-import/fixture/make-stub.sh <вихід.fbk>
#
# Потрібні firebird3.0-utils і firebird3.0-server-core (embedded engine), як у мосту.
# Файл бази лишається лише у тимчасовій теці й видаляється.
set -euo pipefail
OUT="${1:?використання: make-stub.sh <вихід.fbk>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export FIREBIRD_LOCK="$TMP" FIREBIRD_TMP="$TMP"
DB="$TMP/stub.fdb"
sed "s|__DB__|$DB|" "$HERE/stub-db.sql" > "$TMP/stub.sql"
isql-fb -q -b -user SYSDBA -charset NONE -i "$TMP/stub.sql" >"$TMP/isql.log" 2>&1 || { cat "$TMP/isql.log" >&2; exit 1; }
gbak -b -user SYSDBA "$DB" "$OUT" >"$TMP/gbak.log" 2>&1 || { cat "$TMP/gbak.log" >&2; exit 1; }
echo "stub.fbk: $(stat -c %s "$OUT") байт → $OUT"
