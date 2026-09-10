# Міст Winhotel — окремий контейнер із Firebird 3 у вбудованому режимі.
#
# Навіщо окремий образ: Firebird не має жити в образі застосунку
# (Dockerfile застосунку не змінюється — рішення задачі
# docs/tasks/2026-09-10-block-winhotel-import.md §1). Міст не має мережі
# (`network_mode: none` у compose), не знає Postgres і бачить лише том зі
# знімками та свою робочу теку.
#
# `node:22-bookworm-slim` — це debian:bookworm-slim із node 22; поверх —
# `firebird3.0-utils` (gbak, isql-fb) і `firebird3.0-server-core` (вбудований
# рушій libEngine12 — саме він дає `gbak -c` і `isql` без сервера й без
# пароля, як у docs/research/winhotel/extract.sh). Пакет сервера має debconf
# про пароль SYSDBA — `DEBIAN_FRONTEND=noninteractive` пропускає його: у
# вбудованому режимі пароль не читається.
#
# Користувач — uid 1001, той самий, що `nextjs` в образі застосунку: файли на
# спільному томі мусять читатись з обох боків, а те, що пише міст
# (`<id>/*.jsonl`, маркери), — застосунком.
#
# Збірка — лише з профілем:  docker compose --profile bridge build bridge
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends firebird3.0-utils firebird3.0-server-core \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 1001 bridge \
 && useradd --uid 1001 --gid 1001 --home-dir /home/bridge --create-home bridge \
 && mkdir -p /snapshots /work /var/log/firebird \
 && chown -R 1001:1001 /snapshots /work /var/log/firebird \
 && chmod 0775 /var/log/firebird

WORKDIR /bridge
COPY deploy/bridge/bridge.mjs ./bridge.mjs
COPY deploy/bridge/lib ./lib
# SQL сутностей живе поруч із застосунком (apps/winhotel-import/sql) — одне
# джерело і для контейнера, і для bridge-local.sh; сюди — копія при збірці.
COPY apps/winhotel-import/sql ./sql

USER bridge
ENV WINHOTEL_SQL_DIR=/bridge/sql \
    FIREBIRD_LOCK=/work \
    FIREBIRD_TMP=/work \
    NODE_ENV=production

ENTRYPOINT ["node", "/bridge/bridge.mjs"]
CMD ["--watch", "/snapshots", "--work", "/work", "--interval", "30"]
