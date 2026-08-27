import { getReport } from '@reports';
import { withModule } from '@core/auth/session';
export const GET = await withModule('reports', 'view_reports', getReport);
