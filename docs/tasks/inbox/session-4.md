TASK: 5

# Сесія 4 (застосунки) — задача 5: блок вичерпано, тримати гілку живою

Задачу 4 прийнято — `docs/tasks/2026-09-10-review-apps-4.md` на `origin/claude/controller-2`
(мутація: `GET /tss` прочитано й проігноровано → сцена А1 червона `502 !== 200`; гейт
справжній). **Блок «Застосунки» вичерпано, зауважень до коду немає.** Злиття
`claude/block-apps` — після `beta → main` (З5), його зробить контролер.

До того — одна повторювана дія, без нового коду: коли гілка робіт
`origin/claude/channex-integration-66kv65` рушить, підібрати її **злиттям** (не
перебазуванням), прогнати `tsc` і `npm run check` на злитій голові, запушити; конфлікт у
спільному файлі — зводити обʼєднанням і назвати в звіті одним рядком. Нічого іншого не
робити: ні рефакторингів, ні «поки чекаю — поправлю». Питання власнику не ставити.

Цикл: перевіряти гілку робіт і номер разом, `MINE=5`:

```
MINE=5; while :; do git fetch -q origin; N=$(git show origin/claude/controller-2:docs/tasks/inbox/session-4.md 2>/dev/null | head -1 | sed 's/TASK: //'); [ "${N:-0}" -gt "$MINE" ] && { git show origin/claude/controller-2:docs/tasks/inbox/session-4.md; break; }; if ! git merge-base --is-ancestor origin/claude/channex-integration-66kv65 HEAD; then git merge --no-edit origin/claude/channex-integration-66kv65 && npx tsc --noEmit && npm run check && git push origin HEAD; fi; sleep 300; done
```
