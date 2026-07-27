/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Email-forward receipts inbox.
//
// User configures an IMAP mailbox (or alias forwarder pointing to one).
// They forward invoices/receipts to that address. This engine polls the
// mailbox, extracts attachments, saves them to disk, and stores metadata
// in fin_pending_receipts for later linking to a fin_operation.
//
// Optional auto-match: scans subject + body for amounts, tries to match
// against a recent unattached fin_operation within tolerance. If exactly
// one candidate exists, sets auto_matched_operation_id (suggestion only —
// user still confirms via UI).
//
// Reuses the AES-256-GCM encryption + IMAP polling pattern from
// bank-inbox-engine. Storage layout mirrors fin_operation_attachments
// (data/attachments/<orgId>/<YYYY-MM>/...).
//

import { ImapFlow } from 'imapflow';
import { simpleParser, type Attachment } from 'mailparser';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { decryptPassword } from './bank-inbox-engine';

const DATA_DIR = path.join(process.cwd(), 'data');
const ATTACH_ROOT = path.join(DATA_DIR, 'attachments');

const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'application/vnd.', 'application/zip'];

export interface ReceiptInboxConfig {
  id: string;
  organization_id: string;
  imap_host: string;
  imap_port: number;
  imap_user: string;
  imap_password_encrypted: string;
  imap_folder: string;
  use_tls: number;
  sender_filter: string | null;
  subject_filter: string | null;
  auto_match_threshold_pct: number;
  last_uid: number | null;
}

export interface CheckReceiptResult {
  newEmails: number;
  attachmentsImported: number;
  autoMatched: number;
  errors: string[];
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 80);
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function isAllowedAttachment(mime: string | null, filename: string): boolean {
  const m = (mime || '').toLowerCase();
  const ext = filename.toLowerCase();
  if (ALLOWED_MIME_PREFIXES.some((p) => m.startsWith(p))) return true;
  // Some servers strip mime; accept by extension as fallback
  return /\.(pdf|jpe?g|png|gif|webp|heic|heif|xlsx?|docx?)$/.test(ext);
}

/**
 * Extract a candidate amount from the email subject + body. Looks for
 * patterns like "1,234.56 EUR", "€ 240", "240,50 Kč", "CZK 1500".
 * Returns first reasonable hit. Used for auto-matching.
 */
function detectAmount(text: string): { amount: number; currency: string } | null {
  if (!text) return null;
  // Common patterns: amount + currency code/symbol, OR currency + amount
  const patterns = [
    /([0-9]{1,3}(?:[\s.,][0-9]{3})*(?:[.,][0-9]{2})?)\s*(EUR|CZK|USD|GBP|€|Kč|\$|£)/i,
    /(EUR|CZK|USD|GBP|€|Kč|\$|£)\s*([0-9]{1,3}(?:[\s.,][0-9]{3})*(?:[.,][0-9]{2})?)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    let rawAmt: string;
    let rawCur: string;
    if (re.source.startsWith('(EUR')) {
      rawCur = m[1];
      rawAmt = m[2];
    } else {
      rawAmt = m[1];
      rawCur = m[2];
    }
    const num = parseFloat(rawAmt.replace(/\s/g, '').replace(/,(?=\d{3})/g, '').replace(',', '.'));
    if (!isFinite(num) || num <= 0) continue;
    const curMap: Record<string, string> = {
      '€': 'EUR', 'EUR': 'EUR',
      'kč': 'CZK', 'kc': 'CZK', 'CZK': 'CZK',
      '$': 'USD', 'USD': 'USD',
      '£': 'GBP', 'GBP': 'GBP',
    };
    const cur = curMap[rawCur] || curMap[rawCur.toLowerCase()] || rawCur.toUpperCase();
    return { amount: num, currency: cur };
  }
  return null;
}

/**
 * Try to find an unattached operation that matches the detected amount
 * within tolerance. Returns operation id or null.
 */
function findMatchOperation(
  db: any,
  orgId: string,
  amount: number,
  currency: string,
  tolerancePct: number,
): string | null {
  const tolerance = Math.max(0.5, amount * (tolerancePct / 100));
  // Limit to operations from last 60 days without any attachments
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().substring(0, 10);
  const candidates = db.prepare(`
    SELECT o.id FROM fin_operations o
    LEFT JOIN fin_operation_attachments a ON a.operation_id = o.id
    WHERE o.organization_id = ?
      AND o.currency = ?
      AND ABS(o.amount - ?) <= ?
      AND o.paid_at >= ?
      AND o.op_type = 'expense'
      AND a.id IS NULL
    GROUP BY o.id
    ORDER BY ABS(o.amount - ?) ASC, o.paid_at DESC
    LIMIT 2
  `).all(orgId, currency, amount, tolerance, sixtyDaysAgo, amount) as { id: string }[];

  // Only suggest if exactly ONE clear candidate
  if (candidates.length === 1) return candidates[0].id;
  return null;
}

export async function checkReceiptInbox(db: any, inbox: ReceiptInboxConfig): Promise<CheckReceiptResult> {
  const result: CheckReceiptResult = { newEmails: 0, attachmentsImported: 0, autoMatched: 0, errors: [] };
  const password = decryptPassword(inbox.imap_password_encrypted);

  const client = new ImapFlow({
    host: inbox.imap_host,
    port: inbox.imap_port,
    secure: !!inbox.use_tls,
    auth: { user: inbox.imap_user, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(inbox.imap_folder);
    try {
      const since = inbox.last_uid ? `${inbox.last_uid + 1}:*` : '1:*';
      let maxUid = inbox.last_uid || 0;

      for await (const msg of client.fetch(since, { uid: true, source: true, envelope: true }, { uid: true })) {
        if (!msg.uid || msg.uid <= (inbox.last_uid || 0)) continue;
        maxUid = Math.max(maxUid, msg.uid);

        const fromAddr = msg.envelope?.from?.[0]?.address || '';
        const subject = msg.envelope?.subject || '';

        if (inbox.sender_filter && !fromAddr.toLowerCase().includes(inbox.sender_filter.toLowerCase())) continue;
        if (inbox.subject_filter && !subject.toLowerCase().includes(inbox.subject_filter.toLowerCase())) continue;

        result.newEmails++;

        try {
          const parsed = await simpleParser(msg.source as Buffer);
          const attachments: Attachment[] = parsed.attachments || [];
          if (attachments.length === 0) continue;

          // Detect amount from subject + body for auto-match
          const fullText = `${subject}\n${parsed.text || ''}\n${parsed.html || ''}`;
          const detected = detectAmount(fullText);
          const matchedOpId = detected
            ? findMatchOperation(db, inbox.organization_id, detected.amount, detected.currency, inbox.auto_match_threshold_pct)
            : null;

          for (const att of attachments) {
            const filename = att.filename || `attachment_uid${msg.uid}`;
            if (!isAllowedAttachment(att.contentType || null, filename)) {
              result.errors.push(`UID ${msg.uid}: attachment "${filename}" type not allowed`);
              continue;
            }

            const id = `prec_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
            const yearMonth = new Date().toISOString().substring(0, 7);
            const orgDir = path.join(ATTACH_ROOT, inbox.organization_id, 'receipts', yearMonth);
            ensureDir(orgDir);

            const cleanName = safeFileName(filename);
            const storedFileName = `${id}_${cleanName}`;
            const fullPath = path.join(orgDir, storedFileName);
            const relPath = path.relative(DATA_DIR, fullPath).replace(/\\/g, '/');

            try {
              fs.writeFileSync(fullPath, att.content);
            } catch (e: any) {
              result.errors.push(`UID ${msg.uid}: write failed — ${e.message}`);
              continue;
            }

            db.prepare(`
              INSERT INTO fin_pending_receipts
                (id, organization_id, inbox_id, file_name, storage_path,
                 mime_type, size_bytes, sender_email, subject, received_at,
                 detected_amount, detected_currency, auto_matched_operation_id, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              id, inbox.organization_id, inbox.id, filename, relPath,
              att.contentType || 'application/octet-stream', att.size || 0,
              fromAddr, subject,
              (msg.envelope?.date || new Date()).toISOString(),
              detected?.amount || null,
              detected?.currency || null,
              matchedOpId,
              matchedOpId ? 'matched' : 'pending',
            );

            result.attachmentsImported++;
            if (matchedOpId) result.autoMatched++;
          }
        } catch (e: any) {
          result.errors.push(`UID ${msg.uid}: ${e.message}`);
        }
      }

      db.prepare(`
        UPDATE fin_receipt_inboxes
        SET last_uid = ?, last_synced_at = datetime('now'),
            last_error = ?,
            emails_processed = emails_processed + ?,
            receipts_imported = receipts_imported + ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        maxUid,
        result.errors.length > 0 ? result.errors.slice(0, 5).join(' | ').slice(0, 1000) : null,
        result.newEmails,
        result.attachmentsImported,
        inbox.id,
      );
      if (result.newEmails > 0) {
        db.prepare("UPDATE fin_receipt_inboxes SET last_email_at = datetime('now') WHERE id = ?").run(inbox.id);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return result;
}

// Rate-limited tick (called from getDb), 15 min interval like bank inbox
const RECEIPT_TICK_INTERVAL_MS = 15 * 60 * 1000;

export async function runReceiptInboxTickIfDue(db: any): Promise<boolean> {
  if (!process.env.BANK_INBOX_SECRET) return false;

  const lastRow = db.prepare("SELECT value FROM fin_system_state WHERE key = 'last_receipt_inbox_tick'").get() as { value: string } | undefined;
  const now = Date.now();
  if (lastRow?.value) {
    const last = Number(lastRow.value);
    if (!isNaN(last) && now - last < RECEIPT_TICK_INTERVAL_MS) return false;
  }
  db.prepare("INSERT OR REPLACE INTO fin_system_state (key, value, updated_at) VALUES ('last_receipt_inbox_tick', ?, datetime('now'))")
    .run(String(now));

  const inboxes = db.prepare("SELECT * FROM fin_receipt_inboxes WHERE is_active = 1").all() as ReceiptInboxConfig[];
  for (const inbox of inboxes) {
    checkReceiptInbox(db, inbox).catch((e: any) => {
      console.log(`[ReceiptInbox] ${inbox.imap_user} error:`, e.message);
      db.prepare("UPDATE fin_receipt_inboxes SET last_error = ?, updated_at = datetime('now') WHERE id = ?")
        .run(String(e.message).slice(0, 1000), inbox.id);
    });
  }
  return inboxes.length > 0;
}
