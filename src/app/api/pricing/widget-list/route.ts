import { updateWidgetPriceItem } from '@properties/widget-prices.handlers';
import { withPermission } from '@core/auth/session';

/**
 * Editing the widget price list. Lives outside /api/widget on purpose: that
 * prefix is public, and this is an administrative write.
 */
export const PUT = withPermission('manage_pricing', (req) => updateWidgetPriceItem(req));
