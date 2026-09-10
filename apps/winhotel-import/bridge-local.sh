#!/usr/bin/env bash
# Живий прохід мосту локально, без docker (задача §2.8, інваріант 27).
#
#   apps/winhotel-import/bridge-local.sh <WINHOTEL.fbk | .fbk.gz | .fdb> <тека-виходу>
#   apps/winhotel-import/bridge-local.sh --stub <тека-виходу>     # на стабі з fixture/
#
# Той самий код, що в контейнері (deploy/bridge/bridge.mjs --once): gbak -c у
# тимчасову теку → SQL із apps/winhotel-import/sql → <тека>/<entity>.jsonl і
# <тека>/aggregates.json. Відновлена база видаляється завжди.
#
# Потрібні firebird3.0-utils + firebird3.0-server-core (embedded) і node 22.
# `aggregates.json` — лише числа, його можна класти в docs/research/winhotel/
# extract-out/; `*.jsonl` містять персональні дані готелю і в git не йдуть.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ "${1:-}" = "--stub" ]; then
  OUT="${2:?використання: bridge-local.sh --stub <тека-виходу>}"
  mkdir -p "$OUT"
  SRC="$OUT/.stub.fbk"
  "$ROOT/apps/winhotel-import/fixture/make-stub.sh" "$SRC"
else
  SRC="${1:?використання: bridge-local.sh <знімок> <тека-виходу>}"
  OUT="${2:?використання: bridge-local.sh <знімок> <тека-виходу>}"
fi

for bin in gbak isql-fb node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "немає $bin — встановіть firebird3.0-utils firebird3.0-server-core node" >&2; exit 2; }
done

WINHOTEL_SQL_DIR="$ROOT/apps/winhotel-import/sql" \
  node "$ROOT/deploy/bridge/bridge.mjs" --once "$SRC" --out "$OUT" --work "$OUT/.work"

[ "${1:-}" = "--stub" ] && rm -f "$SRC"
echo "--- aggregates.json"
cat "$OUT/aggregates.json"
