# Payments Module

> Єдина точка інтеграції з платіжним провайдером Teia. Створення платіжних сесій, обробка вебхуків, повернення коштів, квитанції. Інші модулі не знають нічого про Teia напряму — вони створюють `PaymentIntent` і передають його сюди.

## Статус міграції

- ✅ Низькорівневий клієнт Teia (`domain/teya-client.ts`) перенесено з `src/lib/teya.ts`
- ✅ `src/lib/teya.ts` лишено як shim (re-export) для зворотної сумісності
- ✅ Зареєстровано TypeScript path `@payments`
- ✅ `createPaymentSession(intent)` — універсальна фабрика
- ✅ `resolveSiteCredentials({ slug, id })` — читання per-site Teia-кредів
- ✅ Усі 4 call-sites (widget checkout, guest pay, guest pay-booking, CRM deposit) переписано на `createPaymentSession`
- ✅ Вебхуки `teyaWebhook` і `teyaBotWebhook` перенесено з `@channels` у `@payments`
- ✅ Роути `/api/webhooks/teya` і `/api/webhooks/teya-bot` імпортують з `@payments`
- ✅ Публікація подій `payment.session_created` / `payment.completed` / `payment.failed` через `@core/event-bus`
- ⬜ Підписка `@bookings`, `@guests`, `@crm` на `payment.completed` — зараз SQL-оновлення лишаються в самому вебхуку (legacy). Майбутній крок: перенести SQL у subscribers, щоб вебхук тільки емітив події.

## Публічне API

Імпортуй тільки з `@payments`:

```ts
import {
  createCheckoutSession,
  verifyWebhookSignature,
  refundPayment,
  sendReceipt,
  type PaymentIntent,
  type PaymentSession,
} from '@payments'
```

| Функція / Тип | Опис |
|---|---|
| `createCheckoutSession(opts)` | Створює сесію Teia. Опціонально приймає per-site креди. |
| `verifyWebhookSignature(body, sig)` | RSA-SHA256 перевірка підпису вебхука. |
| `refundPayment(transactionId, amount)` | Повернення коштів через Teia v3. |
| `sendReceipt(transactionId, email)` | Надсилання електронної квитанції через Teia v1. |
| `getTeyaAccessToken(scope?)` | OAuth token з кешем (використовує ENV-креди). |
| `getTeyaAccessTokenWithCreds(id, secret, scope?)` | OAuth token без кешу (для per-site кредів). |
| `type PaymentIntent` | Дискримінований union: booking_full, booking_balance, booking_deposit, service_standalone, service_cart. |
| `type PaymentSession` | Результат створення сесії. |

## Залежності

**Core:**
- `@core/event-bus` — публікація подій `payment.*` (буде у наступному кроці)

**Shared:** — поки немає

**Зовнішнє:**
- Teia API (`api.teya.com` prod / `api.teya.xyz` staging)
- Node `crypto` — RSA-SHA256 для вебхуків, UUID для idempotency

## Змінні середовища

| Змінна | Призначення |
|---|---|
| `TEYA_ENVIRONMENT` | `staging` (default) або `production` |
| `TEYA_CLIENT_ID` | OAuth client ID (глобальний магазин) |
| `TEYA_CLIENT_SECRET` | OAuth client secret |
| `TEYA_STORE_ID` | Store ID для глобального магазину |
| `TEYA_WEBHOOK_PUBLIC_KEY` | Публічний ключ для перевірки вебхука основного магазину |
| `TEYA_CAMPING_WEBHOOK_KEY` | Публічний ключ для CRM-депозитів Camping (бот) |
| `TEYA_GLAMPING_WEBHOOK_KEY` | Публічний ключ для CRM-депозитів Glamping (бот) |

Кожен `booking_sites.payment_config` може override'нути глобальні креди на рівні сайту — це обробляється автоматично через `opts.credentials` у `createCheckoutSession`.

## Події

**Емітить** (`events/published.ts` — типи визначено, емісія буде в наступному кроці):

| Подія | Payload | Коли |
|---|---|---|
| `payment.session_created` | `{ sessionId, intent, amount, currency }` | Після успішного `createCheckoutSession`. |
| `payment.completed` | `{ sessionId, paymentId, intent, amount, currency }` | Після вебхука `payment.succeeded.v1`. |
| `payment.failed` | `{ sessionId, intent, reason? }` | Після вебхука `payment.failed.v1`. |
| `payment.refunded` | `{ sessionId, paymentId, amount, currency }` | Після вебхука `refund.succeeded.v1`. |

**Слухає:** — поки нічого (це кореневий модуль інтеграції, не реагує на доменні події інших).

## Схема даних

Модуль не володіє власними таблицями. Пише у вже існуючі:

| Таблиця | Поля, релевантні для Teia |
|---|---|
| `payments` | `id`, `reservation_id`, `amount`, `currency`, `method='online'\|'card'`, `type='deposit'\|'full'\|'service'`, `status`, `paid_at`, `notes`, `auto_created=1` |
| `reservations` | `payment_id` (session.id), `payment_status`, `deposit_session_id/url/expires_at/paid_at` |
| `booking_service_orders` | `payment_id`, `payment_status`, `promo_code`, `site_id` |
| `service_orders` | `payment_id`, `payment_status`, `service_date` |
| `service_time_slots` | `booking_session_id` (тимчасовий hold слоту під час checkout) |
| `booking_sites.payment_config` | JSON з per-site Teia-кредами |

Після завершення міграції всі ці оновлення будуть відбуватись через підписки інших модулів на події `payment.*`, а не через прямий SQL у вебхуку.

## Структура файлів

```
src/modules/payments/
  api/
    index.ts               ← публічний API (ТІЛЬКИ звідси імпортувати ззовні)
    handlers.ts            ← webhook + payment-return handlers (наступний крок)
  domain/
    teya-client.ts         ← low-level Teia REST client (OAuth, sessions, refunds, webhooks)
    types.ts               ← PaymentIntent, PaymentSession, PaymentStatus
    checkout-session.ts    ← createPaymentSession(intent) — уніфікована фабрика (наступний крок)
    webhook-processor.ts   ← розбір подій вебхука, маршрутизація за metadata (наступний крок)
    amount-resolver.ts     ← розрахунок суми з урахуванням promo, addons, hours (наступний крок)
  data/
    payment.repo.ts        ← SQL для payments (наступний крок)
    site-credentials.repo.ts ← читання booking_sites.payment_config (наступний крок)
  events/
    published.ts           ← типи подій, що емітить модуль
  __tests__/
  README.md
```

## Три магазини Teia

У поточній конфігурації є **три окремі магазини** Teia з різними webhook-ключами:

1. **Основний магазин** (`TEYA_WEBHOOK_PUBLIC_KEY`) — widget checkout, guest portal.
2. **Camping** (`TEYA_CAMPING_WEBHOOK_KEY`) — CRM-депозити від Camping-бронювань.
3. **Glamping** (`TEYA_GLAMPING_WEBHOOK_KEY`) — CRM-депозити від Glamping-бронювань.

Тому зберігаємо два окремі endpoint-и вебхуків: `/api/webhooks/teya` (основний) і `/api/webhooks/teya-bot` (CRM, перевіряє обидва ключі Camping/Glamping).

## Точки розширення

- Новий тип платіжного наміру → додай варіант у `domain/types.ts PaymentIntent` + гілку в `domain/checkout-session.ts` + обробку в `domain/webhook-processor.ts`.
- Новий провайдер (NOT Teia) → створи `domain/<provider>-client.ts`, додай `PaymentProvider` у types, розведи логіку у `checkout-session.ts`.
- Нова подія → додай у `events/published.ts` + у `src/core/event-bus/registry.ts`.

---

*Оновлюй цей файл при кожній значній зміні модуля.*
