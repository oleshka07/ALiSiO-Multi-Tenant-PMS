/**
 * Next.js Instrumentation Hook
 * Runs once when the server starts. Used to initialize background jobs.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run on the Node.js server (not edge, not client)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startHostexCron } = await import('./lib/channels/hostex-cron');
    startHostexCron();

    // Register event subscribers
    const { registerBookingsSubscribers } = await import('@bookings');
    registerBookingsSubscribers();
  }
}
