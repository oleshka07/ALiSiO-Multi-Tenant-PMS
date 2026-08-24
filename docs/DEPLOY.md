# Deployment

Two environments on one VPS, one nginx, one image, two isolated stacks.

| | Branch | Port | Volume | URL |
|---|---|---|---|---|
| Production | `main` | 3130 | `alisio-prod_app-data` | `https://<domain>` |
| Beta | `beta` | 3131 | `alisio-beta_app-data` | `https://beta.<domain>` |

Separate compose projects mean separate volumes: **beta cannot read or write
production's database.** That is the point of having it.

## First-time server setup

**Pick the right script. The wrong one takes other projects on the host
offline.**

### The host serves nothing else

```bash
git clone <repo> /opt/alisio && cd /opt/alisio
sudo ./deploy/setup-vps.sh pms.example.com admin@example.com
```

Installs Docker, nginx and certbot, enables ufw with SSH + nginx as the only
open ports, removes nginx's default site, then hands over to `add-site.sh` for
the server blocks and certificates.

`setup-vps.sh` refuses to run if it sees other sites in `sites-enabled`, an
already-active ufw, or running Docker containers. That guard exists because
`ufw --force enable` closes every port the other projects listen on directly,
and reinstalling nginx restarts it for everyone. Override with
`ALISIO_FORCE_SETUP=1` only if you are certain the detection is wrong.

### The host already runs other projects

This is the usual case. Install nginx, certbot and Docker yourself — or confirm
they are there — and then:

```bash
git clone <repo> /opt/alisio && cd /opt/alisio
sudo ./deploy/add-site.sh pms.example.com admin@example.com
```

`add-site.sh` only ever writes `/etc/nginx/snippets/alisio-proxy.conf`, one
server-block file for this domain, and requests certificates for `<domain>` and
`beta.<domain>` with `--cert-name` so an existing certificate is untouched. It
does not install packages, does not touch the firewall, does not remove the
default site, and refuses to overwrite a server-block file it did not write
itself.

Both A records — `<domain>` and `beta.<domain>` — must resolve to this host
before you run it. The script checks and stops if they do not: certbot's
HTTP-01 challenge would fail, leaving a server block that references
certificates which do not exist, and then `nginx -t` fails and the next reload
takes **every** site on the box down.

### What is running here now

`alisio.rozum.one` and `beta.alisio.rozum.one` share a VPS with several
unrelated projects (rozum, socialio, systemator, holos, goto). nginx there
already serves eight sites and ufw is already configured. On that host, only
`add-site.sh` is safe — `setup-vps.sh` will refuse, which is the intended
behaviour.

Then create the two environment files — they are gitignored and never committed:

```bash
cp deploy/env.prod.example deploy/env.prod
cp deploy/env.beta.example deploy/env.beta
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put a **different** `APP_SECRET_KEY` in each. It encrypts integration
credentials stored in the database (IMAP passwords, API keys), so a leak
from staging must not decrypt production. Losing the production key makes those
credentials unrecoverable — back it up somewhere other than the server.

## The flow

```
work → merge into beta → push → beta deploys itself → check on beta.<domain>
                              → merge into main → push → prod deploys itself
```

```bash
git checkout beta && git merge --no-ff feature/x && git push origin beta
# checks go green, beta updates on its own; verify there, then:
git checkout main && git merge --no-ff beta && git push origin main
```

No `ssh` step in either line any more — that is the point of
`.github/workflows/deploy.yml`. The manual command still exists and is the
same one; it is the fallback, not the flow.

`deploy.sh` refuses to run without a valid 64-hex `APP_SECRET_KEY`, archives the
data volume to `deploy/backups/` before touching anything, rebuilds, and waits
for the app to answer. If it does not come up within 60 seconds it prints the
container logs and exits non-zero.

## How the server gets the code

The server holds its own clone at `/opt/alisio` and `deploy.sh` pulls into it:

```bash
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
```

Two consequences worth knowing before you run it.

**`reset --hard` discards anything edited on the server.** That is deliberate —
the deployed tree must equal the branch, or "what is running" becomes a
question nobody can answer. But it means a quick fix typed directly on the
server disappears at the next deploy, silently and without a copy. Edit
locally, push, deploy. `deploy/env.beta`, `deploy/env.prod` and
`deploy/backups/` survive because they are not tracked.

**Pushing to GitHub now deploys** — see «Деплой автоматичний» below. A green
`checks` run on `main` deploys prod; on `beta`, beta. This paragraph used to
say the opposite, and said it for three days after it stopped being true.

Running it by hand still works and does exactly the same thing:

```bash
ssh <server> 'cd /opt/alisio && ./deploy/deploy.sh beta'
```

The remote is HTTPS on a public repository, so the fetch needs no deploy key.
Making the repository private means adding one — or switching the remote to
SSH — before the next deploy, and the failure would be at fetch time, before
anything is touched.

### What a deploy does, in order

1. Refuses to start unless `APP_SECRET_KEY` in the env file is 64 hex
   characters. Without it the integration credentials in the database cannot
   be decrypted, and that surfaces days later as "the integration stopped working".
2. Fetches and hard-resets to the branch.
3. Archives the data volume to `deploy/backups/` — before touching anything,
   so a bad deploy is undoable. Thirty copies are kept.
4. Rebuilds the image and restarts the container.
5. Waits up to 90 seconds for health, and health means **a POST to
   `/api/auth/login` with junk credentials answering 401 or 400** — a request
   that has to reach the users table. `GET /login` renders from the bundle
   alone: a build that could not load `better-sqlite3` once passed that check
   while every data route returned 500.

If it does not come up, it prints the container logs and exits non-zero. It
does not roll back on its own — see Rollback below.

### The database engine is not chosen by the deploy

`DATABASE_URL` is present in both env files and is **inert on its own**. The
engine is chosen by `DB_DRIVER=postgres`. That is two variables on purpose:
`DATABASE_URL` was left in the env files by a scaffold and pointed at a
Postgres that did not exist, so keying the engine on it would have taken both
environments down at the first deploy after the Postgres driver shipped.

Both beta and prod now run on Postgres — moved 2026-08-07/08 with
`deploy/to-postgres.sh <env>`, which creates the role, loads
`db/postgres/schema.sql`, proves isolation with `rls-check.sql` BEFORE any
data is copied, migrates, and only then writes `DB_DRIVER` into the env file.

Migrations for a database that already exists live in
`db/postgres/migrations/`, numbered and re-runnable. `deploy.sh` applies the
pending ones itself through `deploy/migrate.sh` — see «Міграції накочуються
самі» below. The schema file is for a fresh database; it is not a migration.
See [db/postgres/README.md](../db/postgres/README.md).

## Rollback

```bash
git checkout main && git reset --hard <previous-sha> && git push --force-with-lease
./deploy/deploy.sh prod
```

To restore the database as well — a Postgres dump, `.sql.gz`:

```bash
gunzip -c deploy/backups/alisio-prod-<stamp>.sql.gz \
  | docker exec -i alisio-prod-postgres psql -U alisio_admin -d alisio
```

Restore into an empty database. `pg_dump` carries the schema, the data, the
row-level policies and the grants, so nothing has to be replayed afterwards —
verified by restoring a dump into a fresh database and checking that the
policies came back with it.

The `.tar.gz` archives are older, and they are the SQLite volume: a rollback
point for `DB_DRIVER=`, not a copy of today's data.

```bash
# only when rolling the engine back to SQLite
docker run --rm -v alisio-prod_app-data:/data -v "$PWD/deploy/backups:/b" \
  alpine sh -c 'rm -rf /data/* && tar xzf /b/alisio-prod-<stamp>.tar.gz -C /data'
```

## Beta data

Beta follows the `beta` branch and deploys itself the same way prod does, so
it is only as current as that branch. **Merge into `beta` before `main`** —
that ordering is the entire value of having beta, and it is easy to skip once
prod deploys itself: between 5 and 13 August beta sat ninety-six commits
behind while every change went straight to production.

Beta starts empty and seeds the demo tenant. To reproduce a production problem,
copy the backup across — and remember it then holds real guest data, which is
why the beta host is served with `X-Robots-Tag: noindex` and sits behind the
same login.

## Known limits

- Each environment has its own Postgres database on the same server, on its
  own loopback port (`PG_PORT`), with its own role. The application connects
  as a role that owns nothing, so the row-level policies actually apply to it
  — `FORCE ROW LEVEL SECURITY` covers the owner too, but relying on that alone
  means one table added later without FORCE is a silent read across tenants.
- Backups are local to the server. Copy `deploy/backups/` off-host — a disk
  failure currently takes the backups with it. This is the one limit on this
  list that costs a customer their data, and it is not covered by anything in
  this repository.
- `deploy.sh` dumps Postgres before every deploy and refuses to continue if the
  dump comes out empty. It did not always: it archived the `app-data` volume,
  and kept doing so after the move to Postgres — when that volume held a SQLite
  file that had stopped changing. Every deploy produced a backup, so nothing
  looked wrong, and the live database had none. If a backup is ever the thing
  standing between you and a lost hotel, check what it actually contains first.


---

## Деплой автоматичний

`.github/workflows/deploy.yml`: коли `checks` зеленіє, GitHub підключається до
сервера і запускає той самий `./deploy/deploy.sh`. Не другий шлях деплою — той
самий, викликаний машиною замість того, хто згадав.

**Гілка вирішує середовище**, і це єдине правило:

```
main  →  prod
beta  →  beta
```

Ні вибору, ні поля вводу — отже, і помилитися вибором не можна. Це те саме,
що `deploy.sh` уже робить сам: `beta` викачує гілку `beta`, `prod` — `main`.
Дispatch руками працює так само: з якої гілки запустили, те середовище й
поїде. З гілки, за якою немає середовища, job відмовляється — розкотити
feature-гілку в одне з двох наявних означало б затерти те, чим хтось
користується.

Обидва середовища деплояться з одного файлу й на один тригер **навмисно**.
Бета існує, щоб на ній пробували зміну до того, як її побачить готель. Це
працює, лише поки бета СВІЖА: бета, що відстала на дев'яносто шість комітів,
не перевіряє нічого і при цьому тихо стверджує, що перевірила. Саме так вона
й простояла з 5 по 13 серпня.

Після `checks`, а не на push: `on: push` викотив би комміт, чиї типи ще не
скомпілювались, і зламана збірка вже роздавалася б, поки CI про це доповість.

**Один раз треба покласти чотири секрети** (Settings → Secrets and variables →
Actions), інакше job чесно скаже, чого бракує, і зупиниться:

| Секрет | Що це |
|---|---|
| `DEPLOY_HOST` | сервер |
| `DEPLOY_USER` | ssh-користувач, якому належить робоча копія |
| `DEPLOY_SSH_KEY` | приватний ключ; публічну половину — в `authorized_keys`. Заведіть окремий (`ssh-keygen -t ed25519 -C github-actions -N ""`), а не особистий: цей можна відкликати, не замкнувши себе |
| `DEPLOY_PATH` | абсолютний шлях **теки** робочої копії — не `deploy/deploy.sh`. Помилка виглядає як `cd: ***: Not a directory` |

Секрети спільні для обох середовищ: один сервер, одна робоча копія, два
compose-проєкти. Різняться `deploy/env.prod` і `deploy/env.beta`, і вони
ніколи не залишають сервер.

Руками — `Actions → deploy → Run workflow` з потрібної гілки, або на самому
сервері `./deploy/deploy.sh prod|beta`. Обидва роблять те саме.

### Як прочитати, куди пішов деплой

**У списку запусків кожен деплой позначений гілкою `main` — і прод, і бета.**
Це не помилка й не збій: воркфлоу, запущений подією `workflow_run`, за
визначенням виконується на гілці за замовчуванням, тож `head_branch` самого
запуску — це його власний ref, а не та гілка, що його спричинила. Гілка, яка
справді вирішує середовище, лежить у `github.event.workflow_run.head_branch`.

Це поле виглядає точно як відповідь на питання «куди задеплоїлось», і саме
тому на ньому легко обпектися. Одного разу воно вже коштувало хибного
діагнозу «бета не деплоїться ніколи» — тоді як бета успішно задеплоїлась
двічі, і людину даремно відправили запускати `deploy.sh beta` руками.

Тому середовище тепер написане у **заголовку запуску** (`run-name`) — список
Actions читається без відкривання. Якщо заголовок чомусь не видно, друге
надійне місце — **назва джоба** всередині запуску: `prod` або `beta`.

Коли обидві гілки стоять на одному коміті, деплоїв буде **два** — по одному
на середовище. Це правильно: обидва мають отримати код. Черги вони не
створюють, бо `concurrency` рахується per-environment.

### Міграції накочуються самі

`deploy.sh` між збіркою і перезапуском викликає `deploy/migrate.sh`, який
дивиться в реєстр `schema_migrations` і застосовує те, чого база ще не бачила,
по порядку імен. Кожен файл — власна транзакція і написаний перезапускним, тож
найгірше від зайвого прогону — марна робота, не шкода.

Це не було кроком, який людина мала пам'ятати, бо кожна пропущена міграція
падає **беззвучно**: 0005 змушує чотирнадцять INSERT-ів відскакувати від
політики, 0007 віддає весь гостьовий портал у 404, 0008 робить те саме, щойно
новий код починає ставити `app.public_token` проти бази, яка ще перевіряє
`app.guest_token`. Ніде не пишеться помилка — застосунок просто поводиться
так, ніби фічі не існує.

Подивитись, що чекає, нічого не змінюючи:

```bash
./deploy/migrate.sh prod --list
```

---

## Перед першим справжнім клієнтом

Три речі, і кожна тиха: жодна не падає на деплої, кожна проявляється як
«функція не працює» вже на клієнті.

```bash
# 1. Чи накотили міграції — питаємо саму базу, а не памʼять
DATABASE_URL="postgres://alisio_app:…@127.0.0.1:54330/alisio" \
  node scripts/check-deployed-db.mjs
```

Очікується `база готова приймати клієнта`. Якщо ні — скрипт назве, якої
міграції бракує і чим це обертається. Найдорожчі — `0007` і `0008`: без них
**весь** гостьовий портал відповідає 404, тобто гість переходить за вашим
посиланням і бачить порожнечу. `0008` до того ж заводить `partner_reports`,
без якої публікація звіту падає, а `/report/<токен>` віддає 404.

> `0008` мусить накотитися **разом** із деплоєм, який його вводить, а не після
> нього: код починає ставити `app.public_token`, і база, що досі перевіряє
> `app.guest_token`, гасить гостьовий портал мовчки. Саме тому міграції тепер
> накочує сам деплой (`deploy/migrate.sh`, між збіркою і рестартом) — цей
> пункт лишається як перевірка, а не як крок, який треба не забути.

```bash
# 2. Чи є свіжий дамп — і чи він не порожній
ls -lh deploy/backups/alisio-prod-*.sql.gz | tail -3
```

`.tar.gz` — це стара SQLite, а не сьогоднішні дані. Дамп знімається на
кожному деплої, і деплой зупиняється, якщо дамп вийшов порожній. **Копію
треба тримати поза цим сервером** — це єдине з відомих обмежень, яке коштує
клієнту його даних.

```bash
# 3. Ключ OpenAI, якщо готель має користуватись OCR і перекладом
grep -c '^OPENAI_API_KEY=.\+' deploy/env.prod
```

Порожній ключ — підтримуваний стан, але тоді OCR паспортів кидає помилку в
очі рецепції, а переклад контенту для гостей мовчки не відбувається.

---

## Новий клієнт

```bash
node scripts/provision-org.mjs   --name "Hotel Kyiv" --slug hotel-kyiv --email owner@hotel-kyiv.ua   --city Kyiv --country UA --currency UAH
```

Створює організацію, її власника, перший об'єкт і одну категорію — все в
одній транзакції. Пароль генерується і показується **один раз**, якщо не
передати `--password`.

Усі інтеграції стартують **вимкненими**. Нового клієнта не варто зустрічати
пунктами меню, які відповідають 403; вмикайте кожну в Налаштування → Модулі
та інтеграції, коли для неї справді є ключі (`--enable widget,hostex` — якщо
вже є).

На сервері — всередині контейнера відповідного середовища:

```bash
docker exec -it alisio-beta-app node scripts/provision-org.mjs --name … --slug … --email …
```

## Доступ постачальника до акаунтів клієнтів

Один акаунт, який заходить у будь-який готель — щоб онбордити й лагодити, не
позичаючи пароль клієнта. Заводиться тільки з оболонки:

```bash
docker exec -it alisio-beta-app node scripts/platform-user.mjs --email you@company.com
docker exec -it alisio-prod-app node scripts/platform-user.mjs --email you@company.com
```

Кожне середовище — своя база, тож акаунт на беті це не акаунт на проді;
запустіть двічі, якщо потрібні обидва. Без `--password` пароль генерується і
показується **один раз**. `--list` показує наявні, `--deactivate` вимикає і
закриває відкриті сесії.

Вхід — **`/app/platform/login`**. Сторінка навмисно не звʼязана з екраном
входу готелю: двері, що відчиняють усі готелі, не місце в навігації, якою
користується рецепція.

Далі — список готелів, кнопка «Увійти» в потрібний, і банер на кожному екрані,
поки ви всередині. «Вийти з акаунта» повертає на список.

Що варто знати перед тим, як цим користуватись:

- поки не увійшли в конкретний готель, платформна сесія **не бачить нічого** —
  усі тенантні маршрути відповідають 401;
- вхід і вихід пишуться в журнал ТОГО ГОТЕЛЮ (`platform_audit`), тобто клієнт
  бачить, хто до нього заходив;
- усе, що ви робите всередині, підписується `Підтримка ALiSiO (ваш email)` —
  в аудиті бронювань, у фінансовому журналі, у полі «змінив»;
- сесія живе 24 години, а не 30 днів, як у працівника готелю: це ключ до
  персональних даних гостей усіх клієнтів.

## Ніхто не може увійти

Спершу подивіться на стан облікового запису, а не міняйте пароль наосліп:
«пароль не підходить» і «запис деактивовано» на екрані входу виглядають
однаково, а лікуються по-різному.

```bash
docker exec -it alisio-beta-app node scripts/reset-password.mjs --email owner@hotel.de --show
```

Друкує: чи є такий email узагалі (а якщо ні — список тих, що є), яка роль,
чи активний запис, чи заданий пароль. Нічого не змінює.

Задати пароль:

```bash
# згенерувати і показати ОДИН раз
docker exec -it alisio-beta-app node scripts/reset-password.mjs --email owner@hotel.de

# свій пароль (мінімум 12 символів)
docker exec -it alisio-beta-app node scripts/reset-password.mjs --email owner@hotel.de --password '…'

# заодно активувати деактивований запис
docker exec -it alisio-beta-app node scripts/reset-password.mjs --email owner@hotel.de --activate
```

Скрипт перечитує рядок після запису: UPDATE, який відфільтрувала політика
доступу, повертає успіх і не змінює нічого — саме цей режим відмови й
призвів до появи інструмента. Сесії не чіпаються: зміна пароля не має
викидати колегу, який працює в іншому браузері.

**Якщо відповідь — «Забагато невдалих спроб входу»**, це не про пароль.
Лічильник живе в памʼяті процесу, на IP-адресу, і сам відпускає через
15 хвилин. Скинути негайно — перезапустити контейнер:

```bash
docker restart alisio-beta-app
```
