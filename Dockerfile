# ALiSiO Multi-Tenant PMS

FROM node:22-alpine AS base
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
# better-sqlite3 is a native module and its prebuilt binaries target glibc, not
# musl, so on Alpine it is compiled from source — which needs a toolchain.
# Without these, `npm ci` fails and the image never builds.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# ── Build ────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# bcryptjs, for the operator's tools rather than for the server.
#
# The standalone build inlines it into the compiled server and leaves nothing
# in node_modules, which is right for the application and wrong for
# scripts/provision-org.mjs and scripts/check-isolation.mjs — both import it
# through src/, and both run from this image. Creating the first customer
# failed with "Cannot find package 'bcryptjs'".
#
# Тут раніше стояло ще й «…and both are the only way to reach a database bound
# to loopback inside the compose network». Це БІЛЬШЕ НЕ ТАК і вимірюється
# одним рядком: `deploy/docker-compose.yml:114` публікує базу на
# `127.0.0.1:${PG_PORT}`, тобто з хоста вона досяжна. Але хостовий шлях однак
# не годиться — на сервері немає `node_modules` (усе збирається в Docker,
# `deploy/to-postgres.sh:201`), — тож інструменти й далі ганяються в образі,
# просто причина інша.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bcryptjs ./node_modules/bcryptjs

# ── Інструменти оператора: scripts/ і src/ (Д63) ─────────────────────────────
#
# Без цих трьох рядків крок `apply_hotels` деплою падав із
# `Cannot find module '/app/scripts/apply-hotel.mjs'`, і 10.09.2026 це
# заблокувало прод: бета піднялася, здоровʼя і всі чотири димові перевірки
# зелені, а готель клієнта з файла не налаштувався.
#
# Дірка старша за той день і ширша за один скрипт. У образі запускають
# ПʼЯТЬ інструментів — `apply-hotel`, `provision-org`, `check-isolation`,
# `pg-import`, `seed-demo-stays` — і жодного з них тут не було. Мовчало
# воно тому, що `apply_hotels` пропускав файли на `_` (а справжніх не було),
# а провал `seed-demo-stays` деплой навмисно не валить: єдиний крок, який
# «працював», був тим, чию відмову ковтали.
#
# Чому `src/` ЦІЛКОМ, а не виміряний мінімум. Мінімум виміряний і він
# великий: 43 модулі `src/` на три інструменти (обхід графа імпортів до
# нерухомої точки, не читання чотирьох рядків). Але річ не в числі — річ у
# тому, що курований перелік це ДРУГЕ ДЖЕРЕЛО ІСТИНИ: перший же новий
# `import` у будь-якому з 43 модулів робить його неправдивим, і дізнаємось
# ми про це наступним червоним деплоєм — рівно так, як сьогодні. 18 МБ
# вихідників поруч із `better-sqlite3` на 13 МБ — ціна, яку видно і яка не
# росте несподівано.
#
# `tsconfig.json` — не косметика: `scripts/lib/module-aliases.mjs` читає з
# нього `compilerOptions.paths`, і без нього кожен імпорт через `@core/…`
# не резолвиться.
#
# Типи знімає сам node (strip-only), тому образ на `node:22-alpine` мусить
# лишатися ≥ 22.18 — саме там зняття типів стало типовою поведінкою.
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

# І РІД МОДУЛЯ для вихідників — без цього рядка попередні три марні.
#
# Знято прогоном у відтвореній файловій системі образу, не міркуванням:
# зняття типів у node йде за НАЙБЛИЖЧИМ `package.json`, а в корені образу
# лежить не наш, а той, що поклав Next standalone. Наш кореневий `type` не
# заданий узагалі (тому сцени локально й біжать під
# `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`), standalone же пише
# свій — і `.ts` тоді читаються як CommonJS:
#
#   SyntaxError: Cannot use import statement outside a module
#     at .../src/core/auth/tenant-context.ts:20
#
# Файл біля самих вихідників відповідає на це питання ЛОКАЛЬНО і не залежить
# від того, що Next напише в корені завтра. У репозиторії його немає
# навмисно: там він міняв би поведінку збірки заради рантайму.
RUN printf '{"type":"module"}' > ./src/package.json \
 && chown nextjs:nodejs ./src/package.json

# The SQLite database and guest uploads live here, mounted as volumes by
# deploy/docker-compose.yml. Created up front and owned by the runtime user so a
# first start does not fail writing into a root-owned directory.
RUN mkdir -p /app/data /app/public/uploads \
 && chown -R nextjs:nodejs /app/data /app/public/uploads

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
