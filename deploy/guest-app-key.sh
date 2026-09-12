#!/usr/bin/env bash
#
# Ключ гостьового застосунку — адреса, куди веде QR на склі.
#
#   ./deploy/guest-app-key.sh beta            # що є: обʼєкти і їхні адреси
#   ./deploy/guest-app-key.sh beta <slug|id>  # видати ключ цьому обʼєкту
#   ./deploy/guest-app-key.sh beta <slug|id> --rotate
#
# Чому скрипт, а не «зайди на сервер і виконай». AGENTS §5: оператор не
# працює в терміналі сервера, і разові команди йому не диктуються — немає
# скрипта, спершу створюється скрипт. Це він.
#
# Чому не екран (поки що). Форма налаштувань обʼєкта — «звичайна акуратність»
# за інваріантом 29 і йде окремою задачею; але ключ потрібен РАНІШЕ за форму:
# без нього сторінка не існує за жодною адресою, тобто подивитись на неї
# неможливо взагалі.
#
# `--rotate` не «оновлює» ключ, а ВІДКЛЮЧАЄ старі наліпки: усі надруковані QR
# перестають вести куди-небудь тієї ж секунди. Тому окремим прапорцем.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod|beta) ;;
  *) echo "usage: $0 {prod|beta} [<slug|id>] [--rotate]" >&2; exit 2 ;;
esac
shift

cd "$(dirname "$0")/.."
CONTAINER="alisio-${ENV_NAME}-app"
docker inspect "$CONTAINER" >/dev/null 2>&1 || { echo "контейнера $CONTAINER немає" >&2; exit 2; }

echo "==> guest-app-key: $ENV_NAME"

# Без обʼєкта — перелік. Саме перелік, а не відмова: найчастіше питання тут
# «а яка адреса в цього готелю», і відповідь на нього не має вимагати
# згадувати slug.
if [ $# -eq 0 ]; then
  docker exec "$CONTAINER" node scripts/issue-guest-app-key.mjs --list
  exit 0
fi

TARGET="$1"; shift
ROTATE=""
if [ "${1:-}" = "--rotate" ]; then ROTATE="--rotate"; fi

# Підтвердження лише на заміну: видача ключа обʼєкту, який його не має, нічого
# не ламає, а заміна вбиває надруковані наліпки. Набрати треба саме slug —
# Enter не досить, бо команди, вставлені блоком, відповіли б самі за себе
# (той самий довід, що в apply-db-limits.sh).
if [ -n "$ROTATE" ]; then
  echo "УВАГА: заміна ключа зробить УСІ надруковані QR цього обʼєкта непрацюючими."
  printf 'Наберіть «%s», щоб підтвердити: ' "$TARGET"
  read -r CONFIRM
  [ "$CONFIRM" = "$TARGET" ] || { echo "не підтверджено — нічого не змінено"; exit 1; }
fi

docker exec "$CONTAINER" node scripts/issue-guest-app-key.mjs --property "$TARGET" $ROTATE
