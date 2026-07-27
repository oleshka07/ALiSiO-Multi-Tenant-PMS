/**
 * Channel Manager — barrel export
 */

// Types
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
} from './types';

export { BOOKING_COM_RATE_LIMITS, BOOKING_COM_URLS } from './types';

// Auth
export { getAccessToken, refreshToken, authenticatedFetch, getCredentialsStatus } from './auth';

// Rate Limiter
export { checkRateLimit, recordRequest, getBackoffDelay, withRateLimit, getRateLimitStats } from './rate-limiter';

// RUID Logger
export { logSyncRequest, extractRUID, getSyncLogs, getAllSyncLogs } from './ruid-logger';

// Sync Queue
export {
  enqueueSync,
  enqueueForAllConnections,
  dequeueJob,
  markCompleted,
  markFailed,
  getQueueStats,
  getFailedJobs,
  cleanupOldJobs,
} from './sync-queue';

// XML Builder
export {
  buildHotelInvNotif,
  buildHotelRateAmountNotif,
  buildRestrictions,
  buildResNotifAcknowledge,
  buildHotelDescriptiveInfoRequest,
  buildReservationSummaryRequest,
} from './xml/ota-builder';

// XML Parser
export {
  parseResNotifResponse,
  parseErrorResponse,
  isSuccessResponse,
} from './xml/ota-parser';
