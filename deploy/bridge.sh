#!/usr/bin/env bash
# Міст Winhotel — контейнер `bridge` під профілем compose, лише для готелю,
# що переїжджає з Winhotel (docs/DEPLOY.md «Міст Winhotel»).
#
#   ./deploy/bridge.sh prod|beta up       # зібрати образ і підняти міст
#   ./deploy/bridge.sh prod|beta down     # зупинити (том зі знімками лишається)
#   ./deploy/bridge.sh prod|beta status   # стан контейнера і том знімків
#   ./deploy/bridge.sh prod|beta logs     # хвіст журналу мосту
#
# `deploy.sh` міст не збирає і не піднімає — профіль `bridge` навмисно поза
# звичайним розгортанням: у готелів без Winhotel цього контейнера не існує.
# Міст не має мережі і не знає Postgres; він дивиться на том `winhotel-snapshots`,
# який застосунок монтує в /app/data/winhotel.
set -euo pipefail

ENV="${1:-}"
CMD="${2:-status}"
case "$ENV" in
  prod|beta) ;;
  *) echo "використання: $0 prod|beta up|down|status|logs" >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ENV_FILE="$HERE/env.$ENV"
PROJECT="alisio-$ENV"
[ -f "$ENV_FILE" ] || { echo "немає $ENV_FILE" >&2; exit 2; }

compose() {
  docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f "$ROOT/deploy/docker-compose.yml" --profile bridge "$@"
}

case "$CMD" in
  up)
    compose up -d --build bridge
    compose ps bridge
    ;;
  down)
    compose stop bridge
    compose rm -f bridge
    ;;
  status)
    compose ps bridge || true
    echo "--- том знімків ($PROJECT)"
    docker run --rm -v "${PROJECT}_winhotel-snapshots:/s:ro" alpine:3.20 sh -c 'du -sh /s 2>/dev/null; find /s -maxdepth 2 -name "*.ready" -o -maxdepth 2 -name "*.extracted" -o -maxdepth 2 -name "*.failed" | sort | tail -20' || true
    ;;
  logs)
    compose logs --tail 100 bridge
    ;;
  *)
    echo "невідома команда: $CMD (up|down|status|logs)" >&2; exit 2 ;;
esac
