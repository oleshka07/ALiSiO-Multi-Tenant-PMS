import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * Server-side error delivery to Sentry — with no SDK.
 *
 * The official @sentry/node v8+ pulls the whole OpenTelemetry tree to do, for
 * this codebase, exactly one thing: POST an exception to an ingest URL. The
 * envelope format that POST uses is small, documented and stable, so this
 * module builds it directly: ~40 lines instead of ~40 MB, nothing new in the
 * build, nothing that can fight Next's bundler.
 *
 * Wired into the two places every server error already passes through:
 *   - serverError() in core/http/errors.ts — the single door 143 handlers
 *     answer 500 through (check-error-leak keeps them going through it);
 *   - process-level uncaught/unhandled hooks in src/instrumentation.ts.
 *
 * Rules it lives by:
 *   - SENTRY_DSN unset → every call is a silent no-op. Monitoring is opt-in
 *     per environment, like every other integration here.
 *   - fire-and-forget with a 3s timeout: a monitoring outage must never slow
 *     down or break a guest's request, so the fetch's failure is swallowed
 *     (after one console line — losing telemetry silently is how a "quiet
 *     week" turns out to be a dead DSN).
 *   - environment = ENV_NAME (prod / beta), so the two servers do not mix.
 *
 * The DSN is not a secret in the classic sense (Sentry designed it to be
 * embeddable in public pages) but it lives in deploy/env.* like every other
 * per-environment setting, never in code.
 */

type Frame = { function: string; filename: string; lineno?: number; colno?: number; in_app: boolean };

/** "    at fn (file:12:34)" / "    at file:12:34" → Sentry frames, oldest first. */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split('\n')) {
    const m = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?)(?::(\d+):(\d+))?\)?\s*$/);
    if (!m) continue;
    const filename = m[2] || '';
    frames.push({
      function: m[1] || '<anonymous>',
      filename,
      lineno: m[3] ? Number(m[3]) : undefined,
      colno: m[4] ? Number(m[4]) : undefined,
      in_app: !filename.includes('node_modules'),
    });
  }
  // Error.stack lists newest call first; Sentry wants oldest first.
  return frames.reverse().slice(-50);
}

export function parseDsn(dsn: string): { endpoint: string } | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/\//g, '');
    if (!u.username || !/^\d+$/.test(projectId)) return null;
    return { endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/` };
  } catch {
    return null;
  }
}

/** The three-line envelope Sentry's ingest expects. Exported for the check. */
export function buildEnvelope(
  dsn: string,
  scope: string,
  err: unknown,
  nowIso: string,
  eventId: string,
): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const event = {
    event_id: eventId,
    timestamp: nowIso,
    platform: 'node',
    level: 'error',
    environment: process.env.ENV_NAME || 'dev',
    server_name: hostname(),
    tags: { scope },
    exception: {
      values: [
        {
          type: e.name || 'Error',
          value: e.message || String(err),
          stacktrace: { frames: parseStack(e.stack) },
        },
      ],
    },
  };
  return (
    `${JSON.stringify({ event_id: eventId, sent_at: nowIso, dsn })}\n` +
    `${JSON.stringify({ type: 'event' })}\n` +
    `${JSON.stringify(event)}`
  );
}

let resolved: { endpoint: string; dsn: string } | null | undefined;

/**
 * Ship one error. Never throws, never blocks: the returned promise is already
 * settled-safe and callers do not await it.
 */
export function captureError(scope: string, err: unknown): void {
  if (resolved === undefined) {
    const dsn = process.env.SENTRY_DSN || '';
    const parsed = dsn ? parseDsn(dsn) : null;
    resolved = parsed ? { endpoint: parsed.endpoint, dsn } : null;
    if (dsn && !parsed) console.error('[sentry] SENTRY_DSN is set but not a valid DSN — error delivery is OFF');
  }
  if (!resolved) return;

  try {
    const body = buildEnvelope(
      resolved.dsn,
      scope,
      err,
      new Date().toISOString(),
      randomBytes(16).toString('hex'),
    );
    fetch(resolved.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body,
      signal: AbortSignal.timeout(3000),
    }).catch((e) => console.error('[sentry] delivery failed:', e?.message || e));
  } catch (e) {
    console.error('[sentry] envelope build failed:', e);
  }
}
