export type PaymentProvider = 'teya';

export type PaymentIntentKind =
  | 'booking_full'
  | 'booking_balance'
  | 'booking_deposit'
  | 'service_standalone'
  | 'service_cart'
  | 'reservation_services';

export type TeyaCredentials = {
  client_id: string;
  client_secret: string;
  store_id: string;
};

export type PaymentLineItem = {
  description: string;
  quantity: number;
  unitPriceMajor: number;
};

export type PaymentIntent = {
  kind: PaymentIntentKind;

  amount: number;
  currency: string;
  description: string;
  lineItems?: PaymentLineItem[];

  metadata: Record<string, string>;

  successUrl?: string;
  cancelUrl?: string;
  expiresAt?: string;

  credentials?: TeyaCredentials;
};

export type PaymentSession = {
  sessionId: string;
  sessionToken: string;
  sessionUrl?: string;
  provider: PaymentProvider;
  intentKind: PaymentIntentKind;
};

export type ResolvedSiteCredentials = {
  siteId: string;
  siteUrl?: string;
  credentials: TeyaCredentials;
};

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded';
