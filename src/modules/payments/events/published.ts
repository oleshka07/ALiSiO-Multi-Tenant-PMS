import type { PaymentIntentKind, PaymentProvider } from '../domain/types';

export type PaymentSessionCreatedEvent = {
  sessionId: string;
  provider: PaymentProvider;
  intentKind: PaymentIntentKind;
  amount: number;
  currency: string;
};

export type PaymentCompletedEvent = {
  sessionId: string;
  provider: PaymentProvider;
  intentKind: PaymentIntentKind;
  paymentId: string;
  amount: number;
  currency: string;
};

export type PaymentFailedEvent = {
  sessionId: string;
  provider: PaymentProvider;
  intentKind: PaymentIntentKind;
  reason?: string;
};

export type PaymentRefundedEvent = {
  sessionId: string;
  provider: PaymentProvider;
  paymentId: string;
  amount: number;
  currency: string;
};
