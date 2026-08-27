import { NextResponse } from 'next/server';
import { captureError } from '../monitoring/sentry';

/**
 * What a caller is told when the server breaks, and what the operator is told.
 *
 * 143 handlers answered a 500 with `{ error: error.message }`. That is the
 * database's own voice reaching the browser: «duplicate key value violates
 * unique constraint "fin_operations_source_ref_key"» names a table, a column
 * and a uniqueness rule; «no such column: r.organization_id» draws a map of the
 * schema one failed request at a time; a driver error can carry a connection
 * string. AGENTS.md §6 has forbidden this the whole time, and it kept happening
 * for a reason worth naming: the alternative on offer was a bare string, which
 * threw away the only copy of the diagnostic. Most of those handlers had no
 * `console.error` either — the message in the response WAS the log.
 *
 * So this is not «return a generic string». It is: the detail goes to the
 * server log with a scope that says where, and the caller gets a sentence it
 * can act on. Both halves, one call, no way to do one without the other.
 *
 * For 4xx this does not apply and must not be used. A 400 carrying «check-out
 * before check-in» is the message doing its job, and replacing it with
 * «Внутрішня помилка» would be a downgrade dressed as a security fix.
 */
export function serverError(scope: string, err: unknown, userMessage?: string): NextResponse {
  const detail = err instanceof Error
    ? `${err.message}${err.stack ? `\n${err.stack}` : ''}`
    : String(err);
  console.error(`[${scope}]`, detail);
  // Docker keeps 30 MB of logs; Sentry keeps the error until somebody looks.
  // Fire-and-forget, no-op without SENTRY_DSN — see core/monitoring/sentry.ts.
  captureError(scope, err);

  return NextResponse.json(
    { error: userMessage || 'Внутрішня помилка сервера. Спробуйте ще раз або зверніться в підтримку.' },
    { status: 500 },
  );
}
