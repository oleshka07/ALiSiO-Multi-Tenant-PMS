#!/usr/bin/env bash
#
# Is the disk filling up — say so at 75%, not at 100%.
#
#   ./deploy/check-disk.sh
#
# Runs hourly from cron (setup-backup-cron.sh installs it once, from the prod
# entry — the disk is one per host, two per-env alerts would just repeat each
# other). August 26 is why it exists: the disk hit 100%, Postgres died
# mid-write, and every project on the box answered 502. Nothing had said 75%,
# 85%, 95% on the way there.
#
# Anti-spam: an alert goes to Telegram only when the situation CHANGES — the
# threshold is newly crossed, or usage grew another 5 points since the last
# alert. The hourly cron run itself stays silent while nothing moves. State
# lives in a marker file next to the backups.
set -euo pipefail

cd "$(dirname "$0")/.."
THRESHOLD="${THRESHOLD:-75}"
MARKER="deploy/backups/.disk-alerted"

USE="$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')"

if [ "$USE" -lt "$THRESHOLD" ]; then
  rm -f "$MARKER"
  echo "==> disk ${USE}% — ok (поріг ${THRESHOLD}%)"
  exit 0
fi

LAST="$(cat "$MARKER" 2>/dev/null || echo 0)"
if [ "$USE" -lt $((LAST + 5)) ]; then
  echo "==> disk ${USE}% — уже алертовано на ${LAST}%, мовчу до +5 п.п."
  exit 0
fi

MSG="⚠️ ALiSiO: диск сервера заповнений на ${USE}% (поріг ${THRESHOLD}%).
26 серпня 100% поклали Postgres і всі проєкти на машині. Подивіться, що росте:
du -xh --max-depth=2 / 2>/dev/null | sort -rh | head — або docker system df."
echo "!! $MSG" >&2

# Telegram credentials live in the env files; prod's copy is the canonical
# one, beta's is the fallback so the alert survives a half-configured host.
for ENV_FILE in deploy/env.prod deploy/env.beta; do
  [ -f "$ENV_FILE" ] || continue
  TOKEN="$(grep -E '^TG_ALERT_BOT_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
  CHAT="$(grep -E '^TG_ALERT_CHAT_ID=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
  if [ -n "$TOKEN" ] && [ -n "$CHAT" ]; then
    curl -fsS -m 10 "https://api.telegram.org/bot${TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${CHAT}" \
      --data-urlencode "text=${MSG}" >/dev/null \
      && { echo "$USE" > "$MARKER"; echo "==> алерт надіслано в Telegram"; exit 1; }
  fi
done

echo "!! TG_ALERT_BOT_TOKEN/TG_ALERT_CHAT_ID не задані — алерт лишився в лозі" >&2
echo "$USE" > "$MARKER"
exit 1
