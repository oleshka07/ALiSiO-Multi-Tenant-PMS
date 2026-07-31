import { translateAll } from '@admin';
import { withOwner } from '@core/auth/session';

// Runs a paid translation pass over the whole content set. Owner-only.
export const POST = withOwner(translateAll);
