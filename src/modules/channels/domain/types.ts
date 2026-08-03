/**
 * Channel Manager — Type definitions
 * 
 * Core types for multi-OTA integration (Booking.com, Airbnb, VRBO, etc.)
 */

// ─── Channel Types ───────────────────────────────────────────

export type ChannelCode = 'booking_com' | 'airbnb' | 'vrbo' | 'expedia';

export type ConnectionStatus = 'pending' | 'connected' | 'disconnected' | 'error';

export type ConnectionType =
  | 'RESERVATIONS'
  | 'AVAILABILITY'
  | 'CONTENT'
  | 'PHOTOS'
  | 'REVIEWS'
  | 'MESSAGING'
  | 'PROMOTIONS'
  | 'REPORTING'
  | 'PERFORMANCE'
  | 'PAYMENTS';

export type SyncDirection = 'outbound' | 'inbound';

export type SyncType = 'inventory' | 'rates' | 'restrictions' | 'full';

export type SyncJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type EnvironmentType = 'test' | 'production';

// ─── Channel Connection ──────────────────────────────────────

export interface ChannelConnection {
  id: string;
  organization_id: string;
  channel: ChannelCode;
  external_property_id: string;
  status: ConnectionStatus;
  connection_types: ConnectionType[];
  pricing_model: string;
  credentials_id: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelCredentials {
  id: string;
  organization_id: string;
  channel: ChannelCode;
  environment: EnvironmentType;
  client_id: string;
  client_secret: string;
  access_token: string | null;
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Room & Rate Mapping ─────────────────────────────────────

export interface ChannelRoomMapping {
  id: string;
  connection_id: string;
  unit_type_id: string;
  external_room_type_id: string;
  external_rate_plan_id: string;
  is_active: number; // SQLite boolean
  created_at: string;
  updated_at: string;
}

// ─── Sync Queue ──────────────────────────────────────────────

export interface SyncJob {
  id: string;
  connection_id: string;
  sync_type: SyncType;
  unit_type_id: string | null;
  date_from: string;
  date_to: string;
  status: SyncJobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  priority: number; // lower = higher priority
  created_at: string;
  updated_at: string;
}

export interface SyncLog {
  id: string;
  connection_id: string;
  direction: SyncDirection;
  endpoint: string;
  request_body: string | null;  // truncated to 10KB
  response_status: number | null;
  response_body: string | null; // truncated to 10KB
  ruid: string | null;
  duration_ms: number | null;
  created_at: string;
}

// ─── ARI (Availability, Rates, Inventory) ────────────────────

export interface ARIInventoryUpdate {
  roomTypeId: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;   // YYYY-MM-DD
  totalCount: number;
  availableCount: number;
}

export interface ARIRateUpdate {
  roomTypeId: string;
  ratePlanId: string;
  dateFrom: string;
  dateTo: string;
  basePrice: number;
  weekendPrice: number | null;
  currency: string; // ISO 4217 (CZK, EUR, etc.)
}

export interface ARIRestrictionUpdate {
  roomTypeId: string;
  ratePlanId: string;
  dateFrom: string;
  dateTo: string;
  minStay: number;
  maxStay: number | null;
  closed: boolean;
  closedToArrival: boolean;  // CTA
  closedToDeparture: boolean; // CTD
}

// ─── OTA Reservation (Booking.com 18 mandatory fields) ───────

export interface OTAReservation {
  // Field 1: Booking.com Reservation ID
  externalReservationId: string;
  // Field 2: Status
  status: 'new' | 'modified' | 'cancelled';
  // Field 3: Timestamps
  createdAt: string;
  modifiedAt: string | null;
  // Field 4: Booker details
  bookerFirstName: string;
  bookerLastName: string;
  bookerEmail: string;
  bookerPhone: string | null;
  isGeniusGuest: boolean;
  // Field 5: Guest names
  guestNames: Array<{ firstName: string; lastName: string }>;
  // Field 6: Number of guests
  totalGuests: number;
  adults: number;
  children: number;
  childAges: number[];
  // Field 7: Room Name & ID
  roomName: string;
  roomTypeCode: string;
  // Field 8: Rate Name & ID
  rateName: string;
  ratePlanCode: string;
  mealPlan: string | null;
  cancellationPolicy: string | null;
  // Field 9: Promotions applied
  promotions: string[];
  // Field 10: Rate-rewriting
  rateRewriting: string | null;
  // Field 11: Add-ons
  addOns: Array<{ name: string; price: number; currency: string }>;
  // Field 12: Check-in / Check-out
  checkIn: string;  // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  // Field 13: Price per room night
  pricePerNight: Array<{ date: string; price: number; currency: string }>;
  // Field 14: Additional taxes & fees
  taxes: Array<{ name: string; amount: number; currency: string }>;
  // Field 15: Total price
  totalPrice: number;
  currency: string;
  // Field 16: Smoking preference
  smokingPreference: 'smoking' | 'non-smoking' | 'no_preference';
  // Field 17: Special requests
  specialRequests: string | null;
  // Field 18: Credit card (PCI)
  creditCard: {
    cardType: string;
    cardNumber: string; // masked
    expiryDate: string;
    cardHolderName: string;
    cvc: string | null;
  } | null;
}

// ─── Channel Adapter Interface ───────────────────────────────

/**
 * Unified interface for all OTA channel adapters.
 * Each OTA (Booking.com, Airbnb, VRBO) implements this interface.
 */
export interface ChannelAdapter {
  readonly channel: ChannelCode;

  // Authentication
  getAccessToken(connectionId: string): Promise<string>;
  refreshToken(connectionId: string): Promise<string>;

  // Connections
  getPendingRequests(): Promise<PendingConnectionRequest[]>;
  approveConnection(externalPropertyId: string, connectionTypes: ConnectionType[]): Promise<void>;
  rejectConnection(externalPropertyId: string): Promise<void>;
  getActiveConnections(): Promise<ChannelConnection[]>;
  deactivateConnection(externalPropertyId: string): Promise<void>;

  // ARI (Push)
  pushInventory(connectionId: string, updates: ARIInventoryUpdate[]): Promise<SyncResult>;
  pushRates(connectionId: string, updates: ARIRateUpdate[]): Promise<SyncResult>;
  pushRestrictions(connectionId: string, updates: ARIRestrictionUpdate[]): Promise<SyncResult>;

  // Reservations (Pull)
  pullReservations(connectionId: string): Promise<OTAReservation[]>;
  acknowledgeReservations(connectionId: string, reservationIds: string[]): Promise<void>;
  pullModifications(connectionId: string): Promise<OTAReservation[]>;
  acknowledgeModifications(connectionId: string, reservationIds: string[]): Promise<void>;
}

// ─── Helper Types ────────────────────────────────────────────

export interface PendingConnectionRequest {
  externalPropertyId: string;
  propertyName: string;
  requestedTypes: ConnectionType[];
  requestedAt: string;
}

export interface SyncResult {
  success: boolean;
  itemsProcessed: number;
  errors: Array<{ code: string; message: string }>;
  ruid: string | null;
}

// ─── Rate Limit Config ──────────────────────────────────────

export interface RateLimitConfig {
  endpoint: string;
  maxPerMinute: number;
  currentCount: number;
  windowStart: number;
}

export const BOOKING_COM_RATE_LIMITS: Record<string, number> = {
  'default': 10000,
  '/xml/reservationssummary': 700,
  '/ota/OTA_HotelDescriptiveContentNotif': 75,
  '/ota/OTA_HotelInvNotif': 75,
  '/ota/OTA_HotelProductNotif': 75,
  '/ota/OTA_HotelSummaryNotif': 75,
  '/ota/OTA_HotelDescriptiveInfo': 100,
  '/ota/OTA_HotelRateAmountNotif': 75,
  'token-exchange': 30, // per hour, not per minute
};

export const BOOKING_COM_URLS = {
  test: {
    supply: 'https://supply-xml.booking.com',
    secureSupply: 'https://secure-supply-xml.booking.com',
    auth: 'https://connectivity-authentication.booking.com',
  },
  production: {
    supply: 'https://supply-xml.booking.com',
    secureSupply: 'https://secure-supply-xml.booking.com',
    auth: 'https://connectivity-authentication.booking.com',
  },
} as const;
