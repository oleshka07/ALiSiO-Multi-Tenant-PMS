#!/usr/bin/env bash
#
# Did the kernel ever kill a container for memory — and what limits stand now?
#
#   ./deploy/check-oom.sh prod
#   ./deploy/check-oom.sh beta
#
# mem_limit exists so that a leaking process dies alone instead of taking the
# shared VPS down with it — the same class of shared-fate failure as the
# August 26 disk incident, only for RAM. The failure mode it creates is
# quiet: docker restarts the killed container, the site answers again, and
# the only trace is State.OOMKilled on the LAST exit plus a growing
# RestartCount. Nothing on the screen says a hotel's request was mid-flight.
#
# So this asks docker directly, for every container of one environment:
#   OOMKilled   true means the most recent death was the kernel's doing —
#               the ceiling in deploy/env.<env> (APP_MEM_LIMIT / PG_MEM_LIMIT)
#               is too tight, or something leaks
#   restarts    deaths the restart policy already papered over
#   exit=137    a SIGKILL exit — OOM is the usual suspect when nobody typed
#               `docker stop`
#
# Read-only by design: it inspects and asks, never restarts, never writes.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta}" >&2; exit 2 ;;
esac

FOUND=0
FAIL=0
for c in $(docker ps -a --filter "name=alisio-${ENV_NAME}-" --format '{{.Names}}'); do
  FOUND=1
  docker inspect --format '{{.Name}}
    стан={{.State.Status}}  запущений з {{.State.StartedAt}}
    OOMKilled={{.State.OOMKilled}}  рестартів={{.RestartCount}}  останній exit={{.State.ExitCode}}
    mem_limit={{.HostConfig.Memory}} байт' "$c" | sed 's|^/||'
  if [ "$(docker inspect --format '{{.State.OOMKilled}}' "$c")" = "true" ]; then FAIL=1; fi
done

if [ "$FOUND" = 0 ]; then
  echo "жодного контейнера alisio-${ENV_NAME}-* на цій машині — це сервер?" >&2
  exit 2
fi

if [ "$FAIL" = 1 ]; then
  echo "!! OOMKilled=true: контейнер убито за пам'ять. Стеля — в deploy/env.${ENV_NAME}" >&2
  echo "!! (APP_MEM_LIMIT / PG_MEM_LIMIT); підняти її або шукати витік. Логи:" >&2
  echo "!! ./deploy/logs.sh ${ENV_NAME}" >&2
  exit 1
fi
echo "==> OOM-кілів немає; рестарти вище — привід подивитись логи, не тривога"
