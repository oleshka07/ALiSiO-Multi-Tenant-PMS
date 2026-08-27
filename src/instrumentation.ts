/**
 * Next.js Instrumentation Hook
 * Runs once when the server starts. Used to initialize background jobs.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run on the Node.js server (not edge, not client)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Register event subscribers
    const { registerBookingsSubscribers } = await import('@bookings');
    registerBookingsSubscribers();

    // Errors that never reach a handler — a crash, a floating promise —
    // otherwise die in a 30 MB docker log. `uncaughtExceptionMonitor` on
    // purpose: unlike an `uncaughtException` listener it OBSERVES the crash
    // without cancelling it, so process semantics stay exactly as they were.
    // The guard keeps dev hot-reload from stacking listeners.
    const g = globalThis as { __alisioMonitoringHooked?: boolean };
    if (!g.__alisioMonitoringHooked) {
      g.__alisioMonitoringHooked = true;
      const { captureError } = await import('@core/monitoring/sentry');
      process.on('uncaughtExceptionMonitor', (err) => captureError('process:uncaught', err));
      process.on('unhandledRejection', (reason) => captureError('process:unhandled-rejection', reason));
    }
  }
}
