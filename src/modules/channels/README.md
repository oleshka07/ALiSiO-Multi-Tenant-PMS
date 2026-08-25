# Channels Module

iCal-обмін із зовнішніми каналами бронювань: імпорт брони з OTA за посиланням
`.ics` та експорт власного календаря назад.

Це все, що модуль уміє. Раніше тут жив ще Connectivity API Booking.com — черга
ARI, OAuth-токени, OTA-XML, маппінг типів кімнат — приблизно 3 500 рядків коду,
який ніколи не був підключений до жодного живого готелю й підтримував три
таблиці даних, що завжди лишалися порожніми. Його видалено (міграція 0032).
Історичні брони з міткою `source = 'booking_com'` лишилися й читаються далі —
видалено інтеграцію, а не дані.

Коли Booking.com (чи будь-який інший канал з власним API) реально
знадобиться — він приходить окремим модулем збоку, а не вростає в цей.

## Публічне API

```ts
import { syncIcal, exportIcal } from '@channels'
```

| Функція | Опис |
|---|---|
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
- `@core/auth/session` — `withPermission` на операторських маршрутах
- `@core/security/cron-auth` — `secretAuthFailure` на cron-маршруті

**Внутрішнє:**
- `domain/ical.ts` — parseICal / generateICal (TODO: перенести в `@core/ical`)

## Схема даних

**Таблиці:** `ical_channels`, `ical_sync_log`

`channel_credentials` формально сусідить у назві, але належить не цьому модулю —
там лежать ключі фіскалізації (`@core/integration-credentials`).
`channel_rate_rules` теж не тут — це правила ПДВ у фінансах.

## Структура файлів

```
channels/
  api/
    index.ts                    ← єдина точка експорту
    ical-channels.handlers.ts
    ical-channel.handlers.ts
    ical-sync.handlers.ts
    ical-cron.handlers.ts
    ical-export.handlers.ts
  domain/
    ical.ts
```

## Точки розширення

- Новий OTA через iCal → нічого не треба, це запис у `ical_channels`
- Новий OTA з власним API → окремий модуль, не сюди

---

*Оновлюй цей файл при будь-якій значній зміні модуля.*
