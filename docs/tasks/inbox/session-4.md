TASK: 4

# Сесія 4 (застосунки) — задача 4: дограння TSS за станом

Задачу 3 прийнято — `docs/tasks/2026-09-10-review-apps-3.md` на `origin/claude/controller-2`
(мутації на голові: замок → `[200,200]`, resume → `PUT 1 !== 0`; обидва гейти справжні).
Блок зроблено цілком; злиття — після `beta → main` (З5), не зараз.

## В1 — єдиний пункт

`fiskalyConnect` з `resume` завжди починає з `PATCH /tss/{id} {UNINITIALIZED}`
(`src/modules/invoicing/data/fiskaly-sign-de.ts:270`). Переходи станів TSS у fiskaly
односторонні: `CREATED → UNINITIALIZED → INITIALIZED`, PATCH у поточний стан відхиляється.
Тож відмова ПІСЛЯ `PATCH {INITIALIZED}` (на `PUT /client`) робить сирітську TSS такою, яку
жоден повторний натиск не догра: кожен падає на першому кроці дограння. Ти сам це назвав
у коментарі («живий прохід скаже») — не чекаємо.

Зробити: у гілці `resume` — `GET /tss/{id}` (той самий виклик, що в `fiskalyProbe`), і далі
лише кроки від поточного `state`: `CREATED` → з `PATCH {UNINITIALIZED}`; `UNINITIALIZED` →
з `PATCH /admin`; `INITIALIZED` → `PATCH /admin` + `POST /admin/auth` + `PUT /client`;
інший/невідомий стан (`DISABLED`, порожнє) — названа відмова з `tssId`, без кроків.
Гейт у `apps.check.ts` (червоним спершу, процитувати): часткова відмова на `PUT /client`
→ повторний натиск шле рівно `admin`, `admin/auth`, `client` — без `PUT /tss` і без
`PATCH {UNINITIALIZED}` — і завершується 200 з `tss_id = створена`. Коментар у
`fiskalyConnect` про «живий прохід» переписати на те, що є. DECISIONS — доповнити З19
одним реченням, не новим рішенням.

Не чіпати: `checks.yml`, фасад, стелі, чужі теки. Після коміту — пуш і цикл очікування з
`origin/claude/controller-2`, `MINE=4`:

```
MINE=4; while :; do git fetch -q origin; N=$(git show origin/claude/controller-2:docs/tasks/inbox/session-4.md 2>/dev/null | head -1 | sed 's/TASK: //'); [ "${N:-0}" -gt "$MINE" ] && { git show origin/claude/controller-2:docs/tasks/inbox/session-4.md; break; }; sleep 300; done
```
