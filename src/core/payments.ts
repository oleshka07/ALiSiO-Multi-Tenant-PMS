/**
 * Which payment gateway a hotel has chosen, and the one thing that is still
 * true regardless: nothing here takes money yet.
 *
 * ── Why this file exists ────────────────────────────────────────────────
 *
 * The product used to have exactly one gateway, Teya, wired straight into the
 * widget. It was removed on 2026-08-22, and what stayed behind was its name:
 * the booking widget still offered «Teya Payment Gateway · Visa · Mastercard ·
 * Apple Pay», the site screen advertised «Stripe та PayPal з коробки», the
 * thank-you tab explained that the guest «оплачує через Teya». All of it
 * described a gateway that was no longer in the repository.
 *
 * A hotel reading those screens would conclude it can take cards online. It
 * cannot. That is the gap this file closes: one list of gateways, one honest
 * status per gateway, and one answer to «can this hotel be paid online today»
 * that every screen asks instead of guessing.
 *
 * ── The rule that must not bend ─────────────────────────────────────────
 *
 * Saving an API key is not the same as being able to charge a card. A hotel
 * can paste its Stripe secret here today; the code that would call Stripe does
 * not exist. So `live` below is false for every provider, and `paymentsLive()`
 * reads it — which means no screen can start offering «Оплатити» merely
 * because a key was pasted. The day a gateway ships, its module flips its own
 * flag, and every screen changes with it. One switch, in the open.
 *
 * ── Storage ─────────────────────────────────────────────────────────────
 *
 * Keys go through `channel_credentials` and `seal()`, exactly like fiskaly:
 * owner-only, encrypted at rest, refused outright when APP_SECRET_KEY is
 * missing. There is no second mechanism for payment secrets — a second one
 * would be a second place to get encryption wrong.
 */
import { integrationConfigured, type IntegrationChannel } from './integration-credentials.ts';

export interface PaymentProvider {
  id: string;
  label: string;
  /** One line: what this gateway is, so the owner can tell them apart. */
  note: string;
  /** Where the hotel finds its own keys. */
  where: string;
  /**
   * Whether the code that talks to this gateway exists.
   *
   * All false. This is not a placeholder to be quietly flipped: turning one
   * true is a claim that a guest can complete a card payment end to end and
   * that the money lands in the folio.
   */
  live: boolean;
}

export const PAYMENT_PROVIDERS: readonly PaymentProvider[] = [
  {
    id: 'stripe',
    label: 'Stripe',
    note: 'Картки, Apple Pay, Google Pay. Найширше покриття країн.',
    where: 'Stripe Dashboard → Developers → API keys',
    live: false,
  },
  {
    id: 'paypal',
    label: 'PayPal',
    note: 'PayPal-гаманець і картки через нього.',
    where: 'PayPal Developer → Apps & Credentials',
    live: false,
  },
  {
    id: 'teya',
    label: 'Teya',
    note: 'Еквайринг, поширений у Європі; був у продукті раніше.',
    where: 'Teya Portal → API',
    live: false,
  },
] as const;

export const PAYMENT_CHANNELS: readonly string[] = PAYMENT_PROVIDERS.map((p) => p.id);

export function isPaymentChannel(channel: string): boolean {
  return PAYMENT_CHANNELS.includes(channel);
}

export function paymentProvider(id: string): PaymentProvider | undefined {
  return PAYMENT_PROVIDERS.find((p) => p.id === id);
}

/**
 * Can this hotel be paid online right now?
 *
 * Three things have to be true, and today the third never is:
 *   1. the organization has the online_payments feature;
 *   2. it has saved credentials for some provider;
 *   3. that provider's gateway code exists (`live`).
 *
 * Checking all three rather than the first two is the whole point. A hotel
 * that enabled the module and pasted its keys has done everything asked of it
 * — and the widget must still not show a pay button, because pressing it would
 * lead nowhere. The honest failure is «ще не підключено», not a dead end at
 * the last step of a booking.
 */
export async function connectedPaymentProvider(
  organizationId: string,
): Promise<PaymentProvider | null> {
  for (const provider of PAYMENT_PROVIDERS) {
    if (await integrationConfigured(provider.id as IntegrationChannel, organizationId)) return provider;
  }
  return null;
}

/** True only when a real gateway can charge a card for this organization. */
export async function paymentsLive(organizationId: string): Promise<boolean> {
  const provider = await connectedPaymentProvider(organizationId);
  return !!provider?.live;
}

/** True when some gateway in the product could ever be live. Today: no. */
export function anyGatewayImplemented(): boolean {
  return PAYMENT_PROVIDERS.some((p) => p.live);
}
