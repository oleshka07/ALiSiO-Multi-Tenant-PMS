import { previewIcalCleanup, deleteIcalCleanup } from '@admin';
import { withOwner } from '@core/auth/session';

// Bulk-deletes iCal-imported reservations. Owner-only.
export const GET = withOwner(previewIcalCleanup);
export const DELETE = withOwner(deleteIcalCleanup);
