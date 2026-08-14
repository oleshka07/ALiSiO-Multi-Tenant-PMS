# ALiSiO ERP

ERP для готельного бізнесу, з PMS усередині: номерний фонд і бронювання, але
поруч — фінансовий контур, канали продажу, задачі й звітність власникам. Один
сервер обслуговує багато готелів; кожен бачить лише свої дані.

**Працює:** [alisio.rozum.one](https://alisio.rozum.one) (prod) ·
[beta.alisio.rozum.one](https://beta.alisio.rozum.one) (beta)

---

## Читати перед роботою

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | **правила проєкту** — інваріанти, перевірки перед комітом, обов'язок оновлювати документацію |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | шари, модулі, модель тенантності, guard-и, поточний стан і план |
| [docs/SECURITY-FINDINGS.md](docs/SECURITY-FINDINGS.md) | усі знайдені вразливості й помилки, з інструкцією як шукати те саме деінде |
| [docs/DEPLOY.md](docs/DEPLOY.md) | два середовища, спільний VPS, відкат |
| [db/postgres/README.md](db/postgres/README.md) | схема Postgres, типи даних, row-level security, міграції |
| [product_capabilities_and_value.md](product_capabilities_and_value.md) | що продукт уміє з точки зору готелю |
| [docs/AI-CREW-PLAN.md](docs/AI-CREW-PLAN.md) | розриви «сайт ↔ продукт», план впровадження AI-агентів з вмиканням per-hotel |

Порядок не випадковий: `AGENTS.md` перший, бо система мультитенантна і запит
без обмеження за організацією не падає — він тихо віддає дані іншого клієнта.

Прод і бета працюють на **Postgres** (з 2026-08-07/08), розробка — на SQLite;
двигун обирає `DB_DRIVER`. Що це змінює на практиці — розділ 12
в SECURITY-FINDINGS.md: там запит без контексту орендаря не падає і не
віддає чуже, а **тихо повертає порожнє**, тож поломка виглядає як «функція
зникла».

## Запустити локально

```bash
npm install
npm run dev          # http://localhost:3000
```

База створюється сама в `data/alisio.db` при першому запуску: схема,
міграції й демо-організація.

## Перевірки

```bash
npx tsc --noEmit                   # 0 помилок — обов'язково перед комітом
npm run check                      # доменні self-check'и
npm run lint                       # biome
npm run build:win                  # повний build перед push складних змін

node scripts/audit-tenant.mjs      # ізоляція: таблиці, запити, UNIQUE
node scripts/audit-routes.mjs      # маршрути без визначення особи
node scripts/audit.mjs             # мертвий UI та маршрути
node scripts/check-isolation.mjs   # живий доказ ізоляції (потребує npm run dev)
node scripts/pg-schema.mjs         # перегенерувати цільову схему Postgres
node scripts/smoke-routes.mjs      # усі GET-маршрути під сесією (по build, не dev)
node scripts/check-boundaries.mjs  # наскільки модулі ізольовані
```

`check-isolation.mjs` створює дві справжні організації, ходить API від імені
кожної й перевіряє, що друга не бачить і не нищить дані першої. Це головна
перевірка перед підключенням клієнта.

## Розгортання

```bash
ssh <server> 'cd /opt/alisio && ./deploy/deploy.sh beta'   # спершу beta
ssh <server> 'cd /opt/alisio && ./deploy/deploy.sh prod'   # після перевірки
```

Сервер спільний з іншими проєктами. Для першого налаштування **не запускайте
`setup-vps.sh`** — він вмикає ufw і перезаписує nginx. Використовуйте
`add-site.sh`. Деталі — в [docs/DEPLOY.md](docs/DEPLOY.md).
