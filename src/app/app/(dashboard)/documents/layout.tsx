import FinanceGate from '../finance/_components/FinanceGate';

/**
 * The unlock screen, on the page that needs it.
 *
 * `/app/documents` is where invoices are deleted, invoice and ISDOC batches are
 * built and the accounting period is locked — all of it behind
 * `requireFinanceAccess`, which now enforces the finance step-up passphrase
 * like the rest of the module. Without this wrapper an owner who had set that
 * passphrase would reach this page and get a bare 403 from every button, with
 * the only place to unlock sitting under /app/finance.
 *
 * FinanceGate fails open for anyone who is not the finance owner (the status
 * call answers 403 and it renders the children), so a user who is here for
 * invoice PDFs under `manage_documents` sees no change.
 */
export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  return <FinanceGate>{children}</FinanceGate>;
}
