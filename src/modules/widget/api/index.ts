// ─── Public API of the widget module ─────────────────────────────────────
//
// The booking widget a hotel embeds on its own website. It was not a module:
// 3 400 lines spread across bookings/api, properties/api, the site settings
// screens and a compiled bundle in public/, with no single boundary to cut.
// That is why "remove or rewrite the widget" was a question about a third of
// the system rather than a local decision. It is one now.
//
// Almost every route here is PUBLIC — it is called from the customer's own
// website, so it carries CORS and has no session. The tenant therefore has to
// arrive in the request: siteId, siteSlug or propertyId. A public endpoint
// here must never fall back to "the first active property".

export { getAvailability, getAvailabilityOptions } from './widget-availability.handlers';
export { validatePromo, validatePromoOptions } from './widget-activate.handlers';
export { getWidgetReservation, getWidgetReservationOptions } from './widget-reservation.handlers';
export { trackWidgetEvent, trackWidgetEventOptions } from './widget-event.handlers';
export { createWidgetReservation, createWidgetReservationOptions } from './widget-reserve.handlers';
export { createWidgetCheckoutSession, createCheckoutSessionOptions } from './widget-checkout.handlers';
export { handlePaymentReturn } from './widget-payment-return.handlers';
export { getWidgetServices, bookWidgetService, getWidgetServicesOptions } from './widget-services.handlers';
export { getWidgetCalendar, getWidgetCalendarOptions } from './widget-calendar-public.handlers';
export { getWidgetSiteConfig, getWidgetSiteConfigOptions } from './widget-site.handlers';
export { getWidgetConfig, getWidgetConfigOptions } from './widget-config-public.handlers';

// The published price list. The public GET needs a site; the two session-based
// ones are the dashboard's price editor.
export { getWidgetPriceList, listOwnWidgetPrices, updateWidgetPriceItem } from './widget-prices.handlers';

// Reads a guest's identity document during the booking flow.
export { processWidgetOcr, processWidgetOcrOptions } from './widget-ocr.handlers';

// How the embedded widget performed: sessions, funnel, campaigns, geography.
// This was 774 lines inside bookings, reading only widget tables — moving it
// here is what made the widget removable rather than merely tidier.
export {
  getAnalyticsOverview, getAnalyticsTraffic, getAnalyticsGeo,
  getAnalyticsListings, getAnalyticsCampaigns, getAnalyticsFunnel,
} from './site-analytics.handlers';

// A guest asking to be told when a date frees up. Public, but the site must
// exist, the hotel must have the widget, and one IP gets ten an hour.
export { joinWaitlist, joinWaitlistOptions } from './widget-waitlist.handlers';
