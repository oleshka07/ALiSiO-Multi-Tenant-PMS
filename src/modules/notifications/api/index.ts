// ─── Public API of the notifications module ──────────────────────────────────
// This is the ONLY file other modules may import from.
// Import via: import { ... } from '@notifications'

/**
 * The Telegram transport. It lived in src/lib/channels/ and was imported deep
 * by guests, bookings, tasks, widget, payments and finance — a notification
 * channel filed under channel-manager, with fifteen modules reaching past
 * every boundary to get at it. Notifications own it; this is the door.
 */
export {
  sendTelegramMessage,
  editInChat,
  getChatId,
  getBotToken,
  getAdminChatIds,
} from '../data/telegram-bot';

export {
  getNotificationSettings,
  saveNotificationSettings,
  deleteNotificationSettings,
  testNotificationSettings,
} from './notification-settings.handlers';
