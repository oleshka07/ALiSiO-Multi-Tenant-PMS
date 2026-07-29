import {
  deleteNotificationSettings,
  getNotificationSettings,
  saveNotificationSettings,
} from '@/modules/notifications/api/notification-settings.handlers';

export const GET = getNotificationSettings;
export const PUT = saveNotificationSettings;
export const DELETE = deleteNotificationSettings;
