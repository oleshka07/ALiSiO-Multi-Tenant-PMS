# Guests Module

Manages guest profiles, guest portal (token-based public page), registration, chat, feedback, and service orders.

## Public API

```ts
import {
  listGuests, createGuest,
  getGuest, updateGuest, deleteGuest,
  getGuestPortal,
  registerGuests,
  submitFeedback,
  orderServices,
  payForService,
  getChatMessages, sendChatMessage,
  translateTexts,
} from '@guests';
```

## Responsibilities

- **Guest CRM** — CRUD for guest profiles with stay history
- **Guest Portal** — token-based public page (pre-arrival, in-stay, post-checkout phases)
- **Registration** — multi-guest registration form with find-or-create guest linking
- **Chat** — real-time messaging between guest and staff
- **Feedback** — post-stay feedback saved as reservation activity
- **Services** — additional service ordering + Teya payment integration
- **Translations** — on-demand OpenAI translation of portal content

## Data Layer

| File | Responsibility |
|------|---------------|
| `guests.repo.ts` | Guest CRUD with stay aggregates |
| `guest-portal.repo.ts` | Portal page data (large JOIN + config merge) |
| `registration.repo.ts` | Guest registration (find-or-create, transaction) |
| `chat.repo.ts` | Chat messages read/write |
| `guest-actions.repo.ts` | Feedback, service orders, Teya payment helpers |

## Cross-Module Dependencies

| Dependency | Status | Future plan |
|-----------|--------|-------------|
| `@/lib/sync/guest-lead-sync` | direct import | emit `crm.guest_updated` event |
| `@/lib/rate-limit` | direct import | move to `@shared/rate-limit` |
| `@/lib/teya` | direct import | emit `finance.payment_initiated` event |
| `@/lib/translate` | direct import | move to `@shared/translate` |

## Routes

| Method | Path | Handler |
|--------|------|---------|
| GET | `/api/guests` | `listGuests` |
| POST | `/api/guests` | `createGuest` |
| GET | `/api/guests/[id]` | `getGuest` |
| PATCH | `/api/guests/[id]` | `updateGuest` |
| DELETE | `/api/guests/[id]` | `deleteGuest` |
| GET | `/api/guest/[token]` | `getGuestPortal` |
| POST | `/api/guest/[token]/register` | `registerGuests` |
| POST | `/api/guest/[token]/feedback` | `submitFeedback` |
| POST | `/api/guest/[token]/services` | `orderServices` |
| POST | `/api/guest/[token]/pay` | `payForService` |
| GET | `/api/guest/[token]/chat` | `getChatMessages` |
| POST | `/api/guest/[token]/chat` | `sendChatMessage` |
| POST | `/api/guest/translate` | `translateTexts` |
