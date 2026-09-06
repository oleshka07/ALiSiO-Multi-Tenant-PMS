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

/**
 * Названа відмова — і те, що відрізняє її від помилки драйвера.
 *
 * `serverError` вище розвʼязує половину задачі: 500 не переказує тексту
 * винятку. Друга половина — 4xx, і вона довго виглядала розвʼязаною: «400
 * лишає своє повідомлення» істинне рівно доти, доки в тому `catch` ловиться
 * НАША відмова. Глухий `catch (e) { return { error: e.message }, 400 }` над
 * шматком, що пише в базу, ловить обидва роди одним рукавом: і «amount must
 * be a positive number», і текст CHECK зі списком дозволених значень і
 * назвою колонки. Гірше того, відповідь при цьому 400 — тобто поломка не
 * виглядає поломкою, і в лог не потрапляє нічого (рецензія 07.09 раунд 3;
 * `finance/api/operations.handlers.ts:542` і `:786`).
 *
 * Тому відмова, яку МОЖНА показати людині, кидається явно — `refuse('…')`, —
 * а `catch` розбирає рід: названа відмова їде своїм статусом і своїм
 * текстом, будь-що інше йде в лог і повертає загальне речення. Різниця не в
 * тому, що написано в повідомленні, а в тому, хто його написав.
 *
 * Тримають `scripts/check-error-leak.mjs` (друга вісь) і `errors.check.ts`.
 */
export class Refusal extends Error {
  readonly isRefusal = true;
  readonly status: number;

  // Поле оголошене окремо, не параметром конструктора: `node` виконує тут
  // TypeScript у режимі зрізання типів, а параметр-властивість — це синтаксис,
  // який зрізанням не робиться. Гейти в `.check.ts` бігають саме так.
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'Refusal';
    this.status = status;
  }
}

/** Відмовити з текстом, який побачить людина. Кидає — не повертає. */
export function refuse(message: string, status = 400): never {
  throw new Refusal(message, status);
}

/**
 * Чи це названа нами відмова.
 *
 * Перевіряється й полем, не лише `instanceof`: у Next модуль може бути
 * завантажений двічі (серверний бандл і рут), і тоді класи різні, а
 * поведінка мусить лишатись тією самою.
 */
export function isRefusal(e: unknown): e is Refusal {
  return e instanceof Refusal
    || (typeof e === 'object' && e !== null && (e as { isRefusal?: unknown }).isRefusal === true);
}

/**
 * Один `catch` на обидва роди: названа відмова — своїм статусом і текстом,
 * решта — у лог і 500 загальним реченням.
 */
export function handleError(scope: string, err: unknown, userMessage?: string): NextResponse {
  if (isRefusal(err)) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return serverError(scope, err, userMessage);
}
