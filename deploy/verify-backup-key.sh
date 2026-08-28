#!/usr/bin/env bash
#
# Prove the off-site credentials can WRITE and can NOT read or delete.
#
#   ./deploy/verify-backup-key.sh prod
#
# "The key is write-only" is a claim about the store's configuration, made
# once, in a web console, by a human — exactly the kind of claim that drifts.
# This turns it into a runnable check with three questions:
#
#   upload a marker      must SUCCEED   (otherwise backups cannot leave at all)
#   list the bucket      must FAIL      (read permission the server must not have)
#   delete today's dump  must FAIL      (delete permission the server must not have)
#
# GREEN means: a compromised server could add garbage, and nothing more —
# versioning in the store keeps history even against overwrites. RED on the
# list/delete lines means the key is stronger than it must be: go back to the
# store's console and cut it down (docs/DEPLOY.md → «Бекапи поза сервером»).
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta}" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
ENV_FILE="deploy/env.${ENV_NAME}"
val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true; }

BACKUP_REMOTE="$(val BACKUP_REMOTE)"
[ -n "$BACKUP_REMOTE" ] && [ -f deploy/rclone.conf ] || {
  echo "off-site не налаштовано (BACKUP_REMOTE / deploy/rclone.conf) — нема чого перевіряти" >&2
  exit 1
}

RC=(docker run --rm
    -v "$(pwd)/deploy/rclone.conf:/config/rclone/rclone.conf:ro"
    rclone/rclone)
FAIL=0

# 1. Write must work — tested by the SAME road the real backup takes: copyto
# of a file. The first version piped into `rcat`, and `docker run` here has no
# `-i`, so the pipe never reached the container: on its first live run the
# test printed FAIL while backup.sh was uploading fine right next to it. A
# check that can fail while the thing it checks works is worse than none —
# now both travel the same code path and cannot drift apart.
STAMP="verify-$(date -u +%Y%m%dT%H%M%SZ)"
VDIR="$(mktemp -d)"
trap 'rm -rf "$VDIR"' EXIT
printf 'write-only key check\n' > "${VDIR}/verify.txt"
if docker run --rm \
     -v "${VDIR}/verify.txt:/data/verify.txt:ro" \
     -v "$(pwd)/deploy/rclone.conf:/config/rclone/rclone.conf:ro" \
     rclone/rclone copyto --retries 2 --no-check-dest --s3-no-head \
     /data/verify.txt "${BACKUP_REMOTE}/verify/${STAMP}.txt" >/dev/null 2>&1; then
  echo "OK   запис працює (verify/${STAMP}.txt; lifecycle сховища його прибере)"
else
  echo "FAIL запис НЕ працює — бекапи не залишають сервер" >&2; FAIL=1
fi

# 2. Read must not.
if "${RC[@]}" lsf "${BACKUP_REMOTE}/${ENV_NAME}/" >/dev/null 2>&1; then
  echo "FAIL читання ВДАЛОСЯ — ключ сильніший, ніж має бути: зламаний сервер зміг би прочитати всі дампи. Обріжте ключ до writeFiles/PutObject" >&2
  FAIL=1
else
  echo "OK   читання відхилено"
fi

# 3. Delete must not. Target today's dump name — the file a ransomware run
# would go for first. Refused-по-правах and refused-бо-немає both leave the
# store intact; what must never print here is success.
TODAY="alisio-${ENV_NAME}-daily-$(date +%F).sql.gz"
if "${RC[@]}" deletefile "${BACKUP_REMOTE}/${ENV_NAME}/${TODAY}" >/dev/null 2>&1; then
  echo "FAIL видалення ВДАЛОСЯ — зламаний сервер може стерти власну історію. Обріжте ключ" >&2
  FAIL=1
else
  echo "OK   видалення відхилено"
fi

if [ "$FAIL" = 1 ]; then
  echo "!! ключ не write-only — виправте в консолі сховища і прожeніть ще раз" >&2
  exit 1
fi
echo "==> ключ справді лише на запис — зламаний сервер не прочитає і не зітре історію"
