import { createCheckoutSession as createTeyaSession } from './teya-client';
import { eventBus } from '@core/event-bus';
import type { PaymentIntent, PaymentSession } from './types';

export async function createPaymentSession(intent: PaymentIntent): Promise<PaymentSession> {
  if (intent.amount <= 0) {
    throw new Error(`Invalid payment amount: ${intent.amount}`);
  }

  const amountMinor = Math.round(intent.amount * 100);

  const items = intent.lineItems?.map((li) => ({
    description: li.description,
    quantity: li.quantity,
    unit_price: Math.round(li.unitPriceMajor * 100),
  }));

  const session = await createTeyaSession({
    amount: amountMinor,
    currency: intent.currency,
    description: intent.description,
    items,
    metadata: intent.metadata,
    success_url: intent.successUrl,
    cancel_url: intent.cancelUrl,
    expiresAt: intent.expiresAt,
    credentials: intent.credentials,
  });

  eventBus
    .emit('payment.session_created', {
      sessionId: session.id,
      provider: 'teya',
      intentKind: intent.kind,
      amount: intent.amount,
      currency: intent.currency,
    })
    .catch((e) => console.error('[payments] session_created emit error:', e));

  return {
    sessionId: session.id,
    sessionToken: session.session_token,
    sessionUrl: session.session_url,
    provider: 'teya',
    intentKind: intent.kind,
  };
}
