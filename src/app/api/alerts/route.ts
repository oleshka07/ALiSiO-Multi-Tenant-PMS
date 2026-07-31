import { getAlerts } from '@dashboard';
import { withActor } from '@core/auth/session';
export const GET = withActor(getAlerts);
