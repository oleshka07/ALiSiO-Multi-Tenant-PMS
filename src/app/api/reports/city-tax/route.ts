import { getCityTaxReport } from '@reports';
import { withPermission } from '@core/auth/session';
export const GET = await withPermission('view_reports', getCityTaxReport);
