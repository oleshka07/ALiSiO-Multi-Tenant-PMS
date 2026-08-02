import { listOwnWidgetPrices, updateWidgetPriceItem } from '@widget';
import { withPermission } from '@core/auth/session';

/**
 * Editing the widget price list. Lives outside /api/widget on purpose: that
 * prefix is public, and this is an administrative write.
 */
export const GET = withPermission('manage_pricing', (req, _ctx, actor) => listOwnWidgetPrices(req, actor));
export const PUT = withPermission('manage_pricing', (req, _ctx, actor) => updateWidgetPriceItem(req, actor));
