import { cronAuthFailure } from '@core/security/cron-auth';
import { processSyncQueue } from '@channels';


// POST /api/channels/sync/process — ARI sync queue processor, triggered by cron
export async function POST(request: Request) {
  // An unset secret used to skip the check entirely, and in the container it was unset.
  const denied = cronAuthFailure(request);
  if (denied) return denied;
  return await processSyncQueue();
}
