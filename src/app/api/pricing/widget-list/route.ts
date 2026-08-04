import { listOwnWidgetPrices, updateWidgetPriceItem } from '@widget';
import { withPermission } from '@core/auth/session';

/**
 * Editing the widget price list. Lives outside /api/widget on purpose: that
 * prefix is public, and this is an administrative write.
 */
export const GET = await withPermission('manage_pricing', async (req, _ctx, actor) => await listOwnWidgetPrices(req, actor));
export const PUT = await withPermission('manage_pricing', async (req, _ctx, actor) => await updateWidgetPriceItem(req, actor));
