// ════════════════════════════════════════════════════════════
// Finance module — public API surface
//
// ACCESS POLICY (single source of truth: ./_guard.ts → isFinanceAuthorized):
//   The entire finance module is OWNER-ONLY. Every session-based endpoint —
//   reads AND writes — is wrapped so that only the owner (or an explicit
//   FINANCE_EXTRA_USER_IDS allow-list entry) can reach it. The edge middleware
//   only checks cookie presence; real session validation happens in the guard.
//
//   - await withFinanceRead(...)   → all reads (session + owner)
//   - await withPermission(...)    → all writes (session + owner + feature permission)
//
// NOT wrapped (own auth / no user session):
//   - payment-bridge (createPaymentOperation, hasPaymentOperation,
//     deletePaymentOperationsForReservation) — internal, called programmatically
//   - generateInvoiceForReservation — internal,
//     called from bookings + payments on reservation lifecycle
//   - getReservationPaymentTotals / recalcReservationPaymentStatus — internal
//     (db, reservationId) helpers
//   - pollBankInboxesFromCron — X-Cron-Secret auth
//   - getInvestorPortalData — investor portal token auth
// ════════════════════════════════════════════════════════════

import { withPermission, withFinanceRead } from './_guard';

// ─── Finance step-up passphrase (security) — self-guarded, owner-only ─────────
// These must stay reachable while finance is locked, so they are NOT wrapped
// with withFinanceRead/await withPermission(which require an unlocked session).
export {
  getFinanceSecurityStatus, setupFinancePassphrase,
  unlockFinanceHandler, lockFinanceHandler,
} from './security.handlers';

// ─── Reports & matrices (read) ────────────────────────────────
import {
  getFinanceOverview as _getFinanceOverview,
  getExpectedPayments as _getExpectedPayments, getCashflowMatrix as _getCashflowMatrix,
  getPnlMatrix as _getPnlMatrix, getFinancialIndicators as _getFinancialIndicators,
  getOperationsForDrillDown as _getOperationsForDrillDown, getBalanceSheet as _getBalanceSheet,
  getProjectProfitability as _getProjectProfitability, getAccountStatement as _getAccountStatement,
  getPlanFactReport as _getPlanFactReport,
} from './reports.handlers';
import { getPaidServices as _getPaidServices } from './paid-services.handlers';
export const getFinanceOverview      = await withFinanceRead(_getFinanceOverview);
export const getExpectedPayments     = await withFinanceRead(_getExpectedPayments);
// Звіт «оплачені послуги і чи дійшли вони до книг» — екран був, маршруту не було.
export const getPaidServices         = await withFinanceRead(_getPaidServices);
export const getCashflowMatrix       = await withFinanceRead(_getCashflowMatrix);
export const getPnlMatrix            = await withFinanceRead(_getPnlMatrix);
export const getFinancialIndicators  = await withFinanceRead(_getFinancialIndicators);
export const getOperationsForDrillDown = await withFinanceRead(_getOperationsForDrillDown);
export const getBalanceSheet         = await withFinanceRead(_getBalanceSheet);
export const getProjectProfitability = await withFinanceRead(_getProjectProfitability);
export const getAccountStatement     = await withFinanceRead(_getAccountStatement);
export const getPlanFactReport       = await withFinanceRead(_getPlanFactReport);

// ─── Budgets ──────────────────────────────────────────────────
import {
  listBudgets as _listBudgets,
  upsertBudget as _upsertBudget, deleteBudget as _deleteBudget,
} from './budgets.handlers';
export const listBudgets  = await withFinanceRead(_listBudgets);
export const upsertBudget = await withPermission('manage_finance_settings', _upsertBudget);
export const deleteBudget = await withPermission('manage_finance_settings', _deleteBudget);

// ─── Expense categories (legacy compat) ───────────────────────
import {
  listExpenseCategories as _listExpenseCategories,
  createExpenseCategory as _createExpenseCategory,
} from './expense-categories.handlers';
export const listExpenseCategories = await withFinanceRead(_listExpenseCategories);
export const createExpenseCategory = await withPermission('manage_finance_settings', _createExpenseCategory);

// ─── Categories (PR #2) ───────────────────────────────────────
import {
  listCategories as _listCategories, getCategoryTree as _getCategoryTree,
  createCategory as _createCategory, updateCategory as _updateCategory,
  archiveCategory as _archiveCategory, deleteCategory as _deleteCategory,
  moveCategory as _moveCategory,
} from './categories.handlers';
export const listCategories  = await withFinanceRead(_listCategories);
export const getCategoryTree = await withFinanceRead(_getCategoryTree);
export const createCategory  = await withPermission('manage_finance_settings', _createCategory);
export const updateCategory  = await withPermission('manage_finance_settings', _updateCategory);
export const archiveCategory = await withPermission('manage_finance_settings', _archiveCategory);
export const deleteCategory  = await withPermission('manage_finance_settings', _deleteCategory);
export const moveCategory    = await withPermission('manage_finance_settings', _moveCategory);

// ─── Business units (legacy read) ─────────────────────────────
import { listBusinessUnits as _listBusinessUnits } from './business-units.handlers';
export const listBusinessUnits = await withFinanceRead(_listBusinessUnits);

// ─── Projects (PR #3) ─────────────────────────────────────────
import {
  listProjects as _listProjects, getProjectTree as _getProjectTree,
  createProject as _createProject, updateProject as _updateProject,
  archiveProject as _archiveProject, deleteProject as _deleteProject,
  moveProject as _moveProject,
} from './projects.handlers';
export const listProjects   = await withFinanceRead(_listProjects);
export const getProjectTree = await withFinanceRead(_getProjectTree);
export const createProject  = await withPermission('manage_finance_settings', _createProject);
export const updateProject  = await withPermission('manage_finance_settings', _updateProject);
export const archiveProject = await withPermission('manage_finance_settings', _archiveProject);
export const deleteProject  = await withPermission('manage_finance_settings', _deleteProject);
export const moveProject    = await withPermission('manage_finance_settings', _moveProject);

// ─── Counterparties (PR #4) ───────────────────────────────────
import {
  listCounterparties as _listCounterparties, getCounterpartyTree as _getCounterpartyTree,
  getAliasSuggestions as _getAliasSuggestions,
  createCounterparty as _createCounterparty, updateCounterparty as _updateCounterparty,
  archiveCounterparty as _archiveCounterparty, deleteCounterparty as _deleteCounterparty,
  moveCounterparty as _moveCounterparty,
} from './counterparties.handlers';
export const listCounterparties      = await withFinanceRead(_listCounterparties);
export const getCounterpartyTree     = await withFinanceRead(_getCounterpartyTree);
export const getAliasSuggestions     = await withFinanceRead(_getAliasSuggestions);
export const createCounterparty  = await withPermission('manage_finance_settings', _createCounterparty);
export const updateCounterparty  = await withPermission('manage_finance_settings', _updateCounterparty);
export const archiveCounterparty = await withPermission('manage_finance_settings', _archiveCounterparty);
export const deleteCounterparty  = await withPermission('manage_finance_settings', _deleteCounterparty);
export const moveCounterparty    = await withPermission('manage_finance_settings', _moveCounterparty);

// ─── Tags (PR #5) ─────────────────────────────────────────────
import {
  listTags as _listTags,
  createTag as _createTag, updateTag as _updateTag,
  archiveTag as _archiveTag, deleteTag as _deleteTag,
} from './tags.handlers';
export const listTags   = await withFinanceRead(_listTags);
export const createTag  = await withPermission('manage_finance_settings', _createTag);
export const updateTag  = await withPermission('manage_finance_settings', _updateTag);
export const archiveTag = await withPermission('manage_finance_settings', _archiveTag);
export const deleteTag  = await withPermission('manage_finance_settings', _deleteTag);

// ─── CapEx (legacy) ───────────────────────────────────────────
import { listCapex as _listCapex, createCapex as _createCapex } from './capex.handlers';
import {
  getCapexItem as _getCapexItem,
  updateCapexItem as _updateCapexItem, deleteCapexItem as _deleteCapexItem,
} from './capex-item.handlers';
export const listCapex       = await withFinanceRead(_listCapex);
export const getCapexItem    = await withFinanceRead(_getCapexItem);
export const createCapex     = await withPermission('manage_finance_settings', _createCapex);
export const updateCapexItem = await withPermission('manage_finance_settings', _updateCapexItem);
export const deleteCapexItem = await withPermission('manage_finance_settings', _deleteCapexItem);




// ─── Invoice Reconciliation Journal ───────────────────────────

// ─── Accounts (PR #1) ─────────────────────────────────────────
import {
  listAccounts as _listAccounts,
  createAccount as _createAccount, updateAccount as _updateAccount,
  archiveAccount as _archiveAccount, deleteAccount as _deleteAccount,
  reconcileAccount as _reconcileAccount,
} from './accounts.handlers';
export const listAccounts     = await withFinanceRead(_listAccounts);
export const createAccount    = await withPermission('manage_finance_settings', _createAccount);
export const updateAccount    = await withPermission('manage_finance_settings', _updateAccount);
export const archiveAccount   = await withPermission('manage_finance_settings', _archiveAccount);
export const deleteAccount    = await withPermission('manage_finance_settings', _deleteAccount);
export const reconcileAccount = await withPermission('manage_finance_settings', _reconcileAccount);

// ─── Exchange rates (PR #1) ───────────────────────────────────
import {
  listExchangeRates as _listExchangeRates, getCurrentRate as _getCurrentRate,
  upsertExchangeRate as _upsertExchangeRate, deleteExchangeRate as _deleteExchangeRate,
} from './exchange-rates.handlers';
export const listExchangeRates  = await withFinanceRead(_listExchangeRates);
export const getCurrentRate     = await withFinanceRead(_getCurrentRate);
export const upsertExchangeRate = await withPermission('manage_finance_settings', _upsertExchangeRate);
export const deleteExchangeRate = await withPermission('manage_finance_settings', _deleteExchangeRate);

// ─── Audit log ────────────────────────────────────────────────
import { getFinanceLog as _getFinanceLog } from './log.handlers';
export const getFinanceLog = await withFinanceRead(_getFinanceLog);

// ─── Read-only finance audit (hidden /finance/audit page) ─────
import { getFinanceAudit as _getFinanceAudit } from './audit.handlers';
export const getFinanceAudit = await withFinanceRead(_getFinanceAudit);

// ─── Operations (PR #6) — manage_payments ─────────────────────
// getReservationPaymentTotals / recalcReservationPaymentStatus are internal
// (db, reservationId) helpers used by other handlers — NOT guarded.
export {
  getReservationPaymentTotals, recalcReservationPaymentStatus,
} from './operations.handlers';
import {
  listOperations as _listOperations, getOperation as _getOperation,
  getOperationAudit as _getOperationAudit,
  createOperation as _createOperation, updateOperation as _updateOperation,
  deleteOperation as _deleteOperation, duplicateOperation as _duplicateOperation,
  mergeOperations as _mergeOperations,
  applyRecurringSuggestion as _applyRecurringSuggestion,
} from './operations.handlers';
export const listOperations    = await withFinanceRead(_listOperations);
export const getOperation      = await withFinanceRead(_getOperation);
export const getOperationAudit = await withFinanceRead(_getOperationAudit);
export const createOperation    = await withPermission('manage_payments', _createOperation);
export const updateOperation    = await withPermission('manage_payments', _updateOperation);
export const deleteOperation    = await withPermission('manage_payments', _deleteOperation);
export const mergeOperations    = await withPermission('manage_payments', _mergeOperations);
export const duplicateOperation = await withPermission('manage_payments', _duplicateOperation);
export const applyRecurringSuggestion = await withPermission('manage_payments', _applyRecurringSuggestion);

// ─── Payment bridge — INTERNAL (no HTTP, no guard) ────────────
export {
  createPaymentOperation, hasPaymentOperation, deletePaymentOperationsForReservation,
} from './payment-bridge';

// ─── Auto-rules (PR #7) ───────────────────────────────────────
import {
  listAutoRules as _listAutoRules,
  createAutoRule as _createAutoRule, updateAutoRule as _updateAutoRule,
  deleteAutoRule as _deleteAutoRule, toggleAutoRule as _toggleAutoRule,
  applyAutoRulesToOperations as _applyAutoRulesToOperations,
  autoMatchCounterpartiesAllOps as _autoMatchCounterpartiesAllOps,
} from './auto-rules.handlers';
export const listAutoRules = await withFinanceRead(_listAutoRules);
export const createAutoRule = await withPermission('manage_finance_settings', _createAutoRule);
export const updateAutoRule = await withPermission('manage_finance_settings', _updateAutoRule);
export const deleteAutoRule = await withPermission('manage_finance_settings', _deleteAutoRule);
export const toggleAutoRule = await withPermission('manage_finance_settings', _toggleAutoRule);
export const applyAutoRulesToOperations    = await withPermission('manage_finance_settings', _applyAutoRulesToOperations);
export const autoMatchCounterpartiesAllOps = await withPermission('manage_finance_settings', _autoMatchCounterpartiesAllOps);

// ─── Recurring templates + calendar (PR #8) ───────────────────
import {
  listRecurringTemplates as _listRecurringTemplates,
  createRecurringTemplate as _createRecurringTemplate,
  updateRecurringTemplate as _updateRecurringTemplate,
  deleteRecurringTemplate as _deleteRecurringTemplate,
  toggleRecurringTemplate as _toggleRecurringTemplate,
  runRecurringNow as _runRecurringNow,
} from './recurring.handlers';
export const listRecurringTemplates  = await withFinanceRead(_listRecurringTemplates);
export const createRecurringTemplate = await withPermission('manage_finance_settings', _createRecurringTemplate);
export const updateRecurringTemplate = await withPermission('manage_finance_settings', _updateRecurringTemplate);
export const deleteRecurringTemplate = await withPermission('manage_finance_settings', _deleteRecurringTemplate);
export const toggleRecurringTemplate = await withPermission('manage_finance_settings', _toggleRecurringTemplate);
export const runRecurringNow         = await withPermission('manage_finance_settings', _runRecurringNow);




// ─── Exports (PR #12) — read ──────────────────────────────────
import {
  exportOperations as _exportOperations, exportCashflow as _exportCashflow,
  exportPnl as _exportPnl, exportStatement as _exportStatement,
} from './export.handlers';
export const exportOperations = await withFinanceRead(_exportOperations);
export const exportCashflow    = await withFinanceRead(_exportCashflow);
export const exportPnl         = await withFinanceRead(_exportPnl);
export const exportStatement   = await withFinanceRead(_exportStatement);

// ─── Attachments (PR #23) — read + manage_payments for write ──
import {
  listOperationAttachments as _listOperationAttachments,
  downloadAttachment as _downloadAttachment, getAttachmentCounts as _getAttachmentCounts,
  uploadAttachment as _uploadAttachment, deleteAttachment as _deleteAttachment,
} from './attachments.handlers';
export const listOperationAttachments = await withFinanceRead(_listOperationAttachments);
export const downloadAttachment       = await withFinanceRead(_downloadAttachment);
export const getAttachmentCounts      = await withFinanceRead(_getAttachmentCounts);
export const uploadAttachment = await withPermission('manage_payments', _uploadAttachment);
export const deleteAttachment = await withPermission('manage_payments', _deleteAttachment);






// ─── Finance user access (owner-only management + self-read) ──
import {
  listFinanceAccess as _listFinanceAccess,
  upsertFinanceAccess as _upsertFinanceAccess,
  deleteFinanceAccess as _deleteFinanceAccess,
  getMyFinanceAccess as _getMyFinanceAccess,
} from './finance-access.handlers';
export const listFinanceAccess    = await withPermission('manage_users', _listFinanceAccess);
export const upsertFinanceAccess  = await withPermission('manage_users', _upsertFinanceAccess);
export const deleteFinanceAccess  = await withPermission('manage_users', _deleteFinanceAccess);
export const getMyFinanceAccess   = await withFinanceRead(_getMyFinanceAccess);

// Re-export auth helpers for use in _guard.ts and other modules


// Курс ČNB. Крон ходить по ВСІХ готелях, тож він поза модулем — а отже,
// заходить фасадом, а не в `domain/cnb-rates` напряму.
export { syncCnbRates, fetchCnbFixing, DEFAULT_CNB_CURRENCIES } from '@core/fx/cnb';
export type { CnbFixing, CnbSyncResult } from '@core/fx/cnb';

// ─── Фактурування переїхало ──────────────────────────────────────────────
//
// Фоліо, рахунки, серії, ставки ПДВ, каса, фіскалізація і правила каналів
// тепер у `@invoicing`. Реекспортувати їх звідси було б зручно й
// неправильно: тоді облік лишався б дверима до фактур, і вимкнути його,
// не зачепивши їх, стало б неможливо — тобто розділення існувало б лише
// на папері.
//
// Курс ČNB поїхав у `@core/fx/cnb`: це джерело курсу, а не бухгалтерія, і
// його читає `core/currency.ts`, який не має права залежати від модуля.
