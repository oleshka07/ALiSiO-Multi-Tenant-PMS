#!/usr/bin/env bash
#
# Read one environment's logs without remembering container names.
#
#   ./deploy/logs.sh prod            # last 100 lines of the app
#   ./deploy/logs.sh beta 500        # more of them
#   ./deploy/logs.sh prod -f         # follow live
#   ./deploy/logs.sh prod --db       # postgres instead of the app
#
# Exists because of a rule, not convenience: the operator is never dictated
# one-off server commands (AGENTS.md §5). "подивись логи" is a script with a
# name — one thing to remember, impossible to mistype into someone else's
# container on a VPS shared with five unrelated projects.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta} [n] [-f] [--db]" >&2; exit 2 ;;
esac
shift

CONTAINER="alisio-${ENV_NAME}-app"
TAIL=100
FOLLOW=()
for a in "$@"; do
  case "$a" in
    --db) CONTAINER="alisio-${ENV_NAME}-postgres" ;;
    -f|--follow) FOLLOW=(--follow) ;;
    [0-9]*) TAIL="$a" ;;
    *) echo "unknown argument: $a" >&2; echo "usage: $0 {prod|beta} [n] [-f] [--db]" >&2; exit 2 ;;
  esac
done

docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  echo "no container $CONTAINER — is $ENV_NAME deployed on this machine?" >&2
  echo "state:  ./deploy/status.sh $ENV_NAME" >&2
  exit 1
}

exec docker logs --tail "$TAIL" ${FOLLOW[@]+"${FOLLOW[@]}"} "$CONTAINER"
