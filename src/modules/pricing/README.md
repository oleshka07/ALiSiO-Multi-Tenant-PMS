# Pricing Module

Управління цінами: щоденний прайс-календар, bulk-оновлення, розрахунок вартості проживання.

## Публічне API

```ts
import { getPricing, updatePricing, getBulkPricing, updateBulkPricing, getQuote } from '@pricing'
import type { DayPrice, QuoteResult, PriceUpsertInput } from '@pricing'
```

| Функція | Опис |
|---|---|
| `getPricing(req)` | Місячний прайс-календар для unit type (GET /api/pricing) |
| `updatePricing(req)` | Upsert цін по конкретних датах (PUT /api/pricing) |
| `getBulkPricing(req)` | Ціни за діапазон дат для всіх unit types (GET /api/pricing/bulk) |
| `updateBulkPricing(req)` | Bulk-оновлення з фільтром weekdays/weekends (PUT /api/pricing/bulk) |
| `getQuote(req)` | Розрахунок вартості проживання з fees (POST /api/pricing/quote) |

## Залежності

- `@core/db` — SQLite
- `@/lib/channels/sync-queue` — тимчасовий прямий виклик ARI sync після оновлення цін (буде замінено на `eventBus.emit` після міграції channels)

## Події

**Може емітити** (не підключено):
- `pricing.updated` — після оновлення цін, channels підписується для ARI sync

## Схема даних

**Таблиці:** `price_calendar`, `fees_taxes`, `rate_plans`, `rate_plan_unit_types`, `occupancy_rules`, `child_pricing_rules`, `restrictions`, `promotions`

**Головна таблиця:** `price_calendar` — унікальний запис per `(unit_type_id, date)`.

## Структура файлів

```
pricing/
  api/
    index.ts              ← єдина точка імпорту (@pricing)
    pricing.handlers.ts   ← GET/PUT /api/pricing
    bulk.handlers.ts      ← GET/PUT /api/pricing/bulk
    quote.handlers.ts     ← POST /api/pricing/quote
  data/
    price-calendar.repo.ts ← SQL для price_calendar (read, upsert, bulk)
    quote.repo.ts          ← розрахунок quote + fees/taxes
  domain/
    types.ts              ← DayPrice, QuoteResult, PriceUpsertInput та re-exports
  events/
    published.ts          ← PricingUpdatedEvent type
  README.md
```

## Точки розширення

- Нова логіка ціноутворення → `data/price-calendar.repo.ts`
- Новий тип fees → `data/quote.repo.ts` (switch case)
- ARI sync → замінити `import('@/lib/channels/sync-queue')` на `eventBus.emit('pricing.updated')`
