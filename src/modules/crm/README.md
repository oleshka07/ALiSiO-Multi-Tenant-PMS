# CRM Module

Управляє лідами, CRM-конвеєром (kanban), переписками з гостями через Telegram/Email, AI-відповідями, промптами та базою знань для підтримки гостей.

## Публічне API

```ts
import { listLeads, sendMessage, suggestAiReply, queryAi } from '@crm'
```

| Функція / Тип | Опис |
|---|---|
| `listLeads(req)` | Список лідів з фільтрами |
| `createLead(req)` | Створити ліда |
| `getPipeline()` | Kanban-конвеєр з усіма стадіями |
| `getLead(req, ctx)` | Отримати ліда за ID |
| `updateLead(req, ctx)` | Оновити ліда |
| `deleteLead(req, ctx)` | Видалити ліда |
| `changeLeadStage(req, ctx)` | Перемістити ліда між стадіями |
| `getConversation(req, ctx)` | Переписка з гостем |
| `sendMessage(req, ctx)` | Надіслати повідомлення (Telegram/Email) |
| `checkDedup(req)` | Перевірка дублікатів лідів |
| `createLeadFromBot(req)` | Створити ліда з Telegram-бота |
| `suggestAiReply(req)` | AI-підказка для відповіді гостю |
| `saveTraining(req)` | Зберегти приклад для тренування AI |
| `listTraining()` | Список навчальних прикладів |
| `listPrompts()` | Список AI-промптів |
| `savePrompt(req)` | Зберегти/оновити промпт |
| `deletePrompt(req)` | Видалити промпт |
| `listKnowledge()` | Список статей бази знань |
| `saveKnowledge(req)` | Зберегти статтю |
| `deleteKnowledge(req)` | Видалити статтю |
| `pollEmails()` | Опитати пошту (IMAP) |
| `testEmail()` | Тест Email |
| `pollTelegram()` | Long-poll Telegram getUpdates |
| `handleTelegramCallback(req)` | Обробити callback Telegram-кнопки |
| `queryAi(req)` | Стрімінговий AI-запит (SSE) |

## Залежності

**Модулі** (через публічний API):
- `@core/db` — підключення до БД
- `@core/auth` — перевірка сесії

**Зовнішні lib** (TODO: мігрувати):
- `@/lib/ai/query-engine` — streamAiAnswer, ChatMessage
- `@/lib/translate` — retranslateAll

## Події

**Емітить** (`events/published.ts`):
| Подія | Payload | Коли |
|---|---|---|
| `crm.lead_created` | `{ leadId, source }` | Новий лід |
| `crm.lead_stage_changed` | `{ leadId, fromStage, toStage }` | Переміщення по конвеєру |
| `crm.lead_deleted` | `{ leadId }` | Видалення ліда |
| `crm.message_sent` | `{ leadId, channel }` | Надіслане повідомлення |

## Схема даних

**Таблиці:** `leads`, `crm_messages`, `crm_ai_training`, `crm_ai_prompts`, `crm_knowledge`

## Структура файлів

```
crm/
  api/
    index.ts                        ← єдина точка експорту
    leads.handlers.ts
    lead.handlers.ts
    lead-stage.handlers.ts
    pipeline.handlers.ts
    conversation.handlers.ts
    conversation-messages.handlers.ts
    dedup.handlers.ts
    lead-from-bot.handlers.ts
    ai-suggest.handlers.ts
    ai-training.handlers.ts
    ai-prompts.handlers.ts
    ai-knowledge.handlers.ts
    ai-query.handlers.ts
    email-poll.handlers.ts
    email-test.handlers.ts
    telegram-poll.handlers.ts
    telegram-callback.handlers.ts
  events/
    published.ts
```

## Точки розширення

- Новий канал комунікації → новий handler + зареєструвати в `index.ts`
- Новий AI-інструмент → `ai-*.handlers.ts`
- Нова подія CRM → `events/published.ts` + `src/core/event-bus/registry.ts`

---

*Оновлюй цей файл при будь-якій значній зміні модуля.*
