/**
 * POST /api/finance/accounts/[id]/reconcile — bring a cash account's computed
 * balance in line with what is actually in the till, by writing an adjustment
 * operation for the difference.
 *
 * The handler has been finished and correct in `accounts.handlers.ts` this
 * whole time. This file did not exist, so the «Створити коригування» button in
 * the settings screen posted into a 404 and reported «Не вдалося створити
 * коригування» — a working feature that nobody could reach, because nobody had
 * written the four lines that expose it.
 */
import { reconcileAccount } from '@finance';

export const POST = reconcileAccount;
