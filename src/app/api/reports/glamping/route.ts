import { getGlampingReport } from '@reports';
import { withPermission } from '@core/auth/session';
export const GET = withPermission('view_reports', getGlampingReport);
