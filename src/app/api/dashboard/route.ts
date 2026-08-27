import { getDashboard } from '@dashboard';
import { withModule } from '@core/auth/session';
export const GET = withModule('dashboard', 'nav:dashboard', getDashboard);
