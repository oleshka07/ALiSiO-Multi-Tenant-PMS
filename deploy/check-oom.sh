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
#   restart=    the policy itself. Anything but unless-stopped/always is an
#               alarm: a host reboot leaves that container down, and the only
#               trace is a site that stopped answering. Checked here because
#               this is the script a reboot runbook runs FIRST
#               (docs/DEPLOY.md → «Перезавантаження хоста»).
#   mem_limit   0 means NO ceiling at all — the exact state this script was
#               born from. Until 2026-08-28 it printed the zero and still
#               summarised "all clear": a check that shows the problem but
#               does not fail on it teaches everyone to scroll past. Zero is
#               an alarm, not a number.
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
POLICY_FAIL=0
LIMIT_FAIL=0
for c in $(docker ps -a --filter "name=alisio-${ENV_NAME}-" --format '{{.Names}}'); do
  FOUND=1
  docker inspect --format '{{.Name}}
    стан={{.State.Status}}  запущений з {{.State.StartedAt}}
    OOMKilled={{.State.OOMKilled}}  рестартів={{.RestartCount}}  останній exit={{.State.ExitCode}}
    mem_limit={{.HostConfig.Memory}} байт  restart={{.HostConfig.RestartPolicy.Name}}' "$c" | sed 's|^/||'
  if [ "$(docker inspect --format '{{.State.OOMKilled}}' "$c")" = "true" ]; then FAIL=1; fi
  # Політика рестарту — це «чи встане після перезавантаження хоста».
  # Контейнер без unless-stopped/always після ребута лишиться лежати, і
  # єдиний слід — сайт, який не відповідає.
  POLICY="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$c")"
  case "$POLICY" in
    unless-stopped|always) ;;
    *)
      echo "    !! restart=«${POLICY:-немає}» — після перезавантаження хоста ЦЕЙ контейнер сам не встане"
      POLICY_FAIL=1
      ;;
  esac
  # Стеля нуль — стелі немає: витік у цьому контейнері має право з'їсти
  # пам'ять усього VPS. До 2026-08-28 цей скрипт друкував нуль і все одно
  # підсумовував «зелено» — перевірка, яка показує проблему, але не падає
  # на ній, вчить дивитися повз.
  if [ "$(docker inspect --format '{{.HostConfig.Memory}}' "$c")" = "0" ]; then
    echo "    !! mem_limit=0 — стелі немає: витік тут забере пам'ять усього сервера"
    LIMIT_FAIL=1
  fi
done

if [ "$FOUND" = 0 ]; then
  echo "жодного контейнера alisio-${ENV_NAME}-* на цій машині — це сервер?" >&2
  exit 2
fi

if [ "$FAIL" = 1 ]; then
  echo "!! OOMKilled=true: контейнер убито за пам'ять. Стеля — в deploy/env.${ENV_NAME}" >&2
  echo "!! (APP_MEM_LIMIT / PG_MEM_LIMIT); підняти її або шукати витік. Логи:" >&2
  echo "!! ./deploy/logs.sh ${ENV_NAME}" >&2
fi
if [ "$POLICY_FAIL" = 1 ]; then
  echo "!! Є контейнер без restart unless-stopped/always — ребут хоста його НЕ підніме." >&2
  echo "!! app лікує ./deploy/deploy.sh ${ENV_NAME}; postgres — ./deploy/apply-db-limits.sh ${ENV_NAME}" >&2
  echo "!! (обидва перестворюють контейнер з політикою з docker-compose.yml)." >&2
fi
if [ "$LIMIT_FAIL" = 1 ]; then
  echo "!! Є контейнер без mem_limit (0 = стелі немає). app лікує ./deploy/deploy.sh ${ENV_NAME};" >&2
  echo "!! postgres — ./deploy/apply-db-limits.sh ${ENV_NAME} (свідоме перестворення, ~10–30 с простою)." >&2
fi
if [ "$FAIL" = 1 ] || [ "$POLICY_FAIL" = 1 ] || [ "$LIMIT_FAIL" = 1 ]; then
  exit 1
fi
echo "==> OOM-кілів немає, стелі й політики рестарту на місці; рестарти вище — привід подивитись логи, не тривога"
