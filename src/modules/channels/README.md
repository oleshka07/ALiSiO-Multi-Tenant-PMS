# Channels Module

Інтеграції з зовнішніми каналами бронювань: Hostex OTA sync, Teya payments webhooks, iCal import/export. Відповідає за синхронізацію резервацій і маппінг unit-типів між системами.

## Публічне API

```ts
import { listConnections, hostexSync, syncIcal, exportIcal } from '@channels'
```

| Функція / Тип | Опис |
|---|---|
| `listConnections()` | Список каналів-з'єднань |
| `createConnection(req)` | Додати нове з'єднання |
| `getConnection(req, ctx)` | Отримати з'єднання за ID |
| `updateConnection(req, ctx)` | Оновити з'єднання |
| `deleteConnection(req, ctx)` | Видалити з'єднання |
| `listCredentials(req)` | Облікові дані каналу |
| `upsertCredentials(req)` | Зберегти/оновити облікові дані |
| `listMappings(req)` | Маппінги unit-типів до зовнішніх кодів |
| `upsertMapping(req)` | Зберегти маппінг |
| `deleteMapping(req)` | Видалити маппінг |
| `getSyncStatus(req)` | Статус черги синхронізації |
| `processSyncQueue(req)` | Обробити чергу синхронізації |
| `pollReservations(req)` | Отримати нові резервації з каналу |
| `testChannels(req)` | Перевірка з'єднання з каналом |
| `hostexWebhook(req)` | Обробка вебхука від Hostex |
| `hostexWebhookInfo()` | Метадані вебхука |
| `hostexSync(req)` | Ручна синхронізація з Hostex |
| `hostexSyncStatus(req)` | Статус синхронізації Hostex |
| `hostexReservations(req)` | Список резервацій з Hostex |
| `hostexProperties(req)` | Список properties з Hostex |
| `hostexBulkSync(req)` | Масова синхронізація |
| `listIcalChannels()` | Список iCal каналів |
| `createIcalChannel(req)` | Додати iCal канал |
| `updateIcalChannel(req, ctx)` | Оновити iCal канал |
| `deleteIcalChannel(req, ctx)` | Видалити iCal канал |
| `syncIcal(req)` | Синхронізувати один iCal канал |
| `runIcalCron(req)` | Cron-запуск усіх iCal синхронізацій |
| `exportIcal(req, ctx)` | Генерувати iCal-файл для зовнішніх сервісів |

## Залежності

**Модулі** (через публічний API):
- `@core/db` — підключення до БД
- `@core/auth` — перевірка секретів та сесій

**Зовнішні lib** (TODO: мігрувати):
- `@/lib/ical` — parseICal, generateICal (парсинг та генерація .ics)
- `@/lib/hostex` — HTTP-клієнт для Hostex API

## Події

**Емітить** (`events/published.ts`):
| Подія | Payload | Коли |
|---|---|---|
| `channel.sync_completed` | `{ channelId, count }` | Після успішної синхронізації |
| `channel.reservation_received` | `{ externalId, channelId }` | Нова резервація з каналу |
| `ical.cleanup_executed` | `{ deleted }` | Видалення застарілих iCal резервацій |

## Схема даних

**Таблиці:** `channel_connections`, `channel_credentials`, `channel_unit_mappings`, `channel_sync_queue`, `ical_channels`

## Структура файлів

```
channels/
  api/
    index.ts                    ← єдина точка експорту
    connections.handlers.ts
    connection.handlers.ts
    credentials.handlers.ts
    mapping.handlers.ts
    sync.handlers.ts
    poll.handlers.ts
    test.handlers.ts
    webhook-hostex.handlers.ts
    webhook-teya.handlers.ts
    webhook-teya-bot.handlers.ts
    hostex.handlers.ts
    ical-channels.handlers.ts
    ical-channel.handlers.ts
    ical-sync.handlers.ts
    ical-cron.handlers.ts
    ical-export.handlers.ts
  events/
    published.ts
```

## Точки розширення

- Новий OTA-канал → новий `<channel>.handlers.ts`, зареєструвати в `index.ts`
- Новий формат синхронізації → розширити `sync.handlers.ts` або `poll.handlers.ts`
- Нова подія → `events/published.ts` + `src/core/event-bus/registry.ts`

---

*Оновлюй цей файл при будь-якій значній зміні модуля.*
