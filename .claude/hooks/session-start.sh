#!/usr/bin/env bash
#
# Що бачить кожна сесія, перш ніж торкнутися коду.
#
# CLAUDE.md імпортує правила проєкту (@AGENTS.md), але правила не знають,
# у якому стані репозиторій СЬОГОДНІ. Це друкує стан: гілку, незбережені
# зміни, хвіст розділу «Стан і що далі» — і головне, чи не втік main уперед
# від beta. Порядок «спершу beta, потім main» уже порушувався на 96 комітів
# (5–13 серпня), і ніщо тоді про це не сказало.
#
# Хук інформує, не блокує: його збій не має права зупинити сесію, тому
# мережеві кроки best-effort і вихід завжди 0.
set -u

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" || exit 0

echo "── Стан репозиторію на старті сесії ─────────────────────────────────"
echo "Гілка: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"

STATUS="$(git status --short 2>/dev/null || true)"
if [ -n "$STATUS" ]; then
  echo "Незбережені зміни:"
  echo "$STATUS" | head -20
else
  echo "Робоча копія чиста."
fi

# Свіжі main і beta — інакше порівнювати нічого: клон веб-сесії часто
# приходить узагалі без beta.
git fetch --quiet origin main beta 2>/dev/null || true

if git rev-parse --verify --quiet origin/beta >/dev/null 2>&1; then
  AHEAD="$(git rev-list --count origin/beta..origin/main 2>/dev/null || echo 0)"
  if [ "${AHEAD:-0}" != "0" ]; then
    echo ""
    echo "!! MAIN ПОПЕРЕДУ BETA НА ${AHEAD} КОМІТ(ІВ)."
    echo "!! Прод обслуговує код, якого бета не бачила. Порядок проєкту:"
    echo "!! спершу merge у beta, перевірка на беті, потім у main (docs/DEPLOY.md)."
    echo "!! СКАЖИ ПРО ЦЕ ЛЮДИНІ ПЕРШИМ РЯДКОМ СВОЄЇ ПЕРШОЇ ВІДПОВІДІ."
  fi
else
  echo "(origin/beta недоступна — відставання перевірити не вдалося)"
fi

echo ""
echo "── docs/ARCHITECTURE.md §8 — «Лишається» ────────────────────────────"
awk '/^\*\*Лишається:\*\*/{f=1} f' docs/ARCHITECTURE.md 2>/dev/null | head -40
echo "─────────────────────────────────────────────────────────────────────"
exit 0
