// Re-export all channel types from lib (single source of truth)
export type {
  ChannelCode,
  ConnectionStatus,
  ConnectionType,
  SyncDirection,
  SyncType,
  SyncJobStatus,
  EnvironmentType,
  ChannelConnection,
  ChannelCredentials,
  ChannelRoomMapping,
  SyncJob,
  SyncLog,
  ARIInventoryUpdate,
  ARIRateUpdate,
  ARIRestrictionUpdate,
  OTAReservation,
  ChannelAdapter,
  PendingConnectionRequest,
  SyncResult,
  RateLimitConfig,
} from '@/lib/channels/types';

export { BOOKING_COM_RATE_LIMITS, BOOKING_COM_URLS } from '@/lib/channels/types';
