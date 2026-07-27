// Shim — real implementation moved to src/modules/payments/domain/teya-client.ts.
// This file is kept so existing imports (`@/lib/teya`) keep working during migration.
// New code should import from `@payments` instead.

export {
  createCheckoutSession,
  verifyWebhookSignature,
  refundPayment,
  sendReceipt,
  getTeyaAccessToken,
  getTeyaAccessTokenWithCreds,
} from '@/modules/payments/domain/teya-client';

export type {
  CheckoutSessionOptions,
  CheckoutSessionResult,
  TeyaLineItem,
} from '@/modules/payments/domain/teya-client';
