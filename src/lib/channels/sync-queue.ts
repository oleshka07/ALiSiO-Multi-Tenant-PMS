/**
 * Sync Queue — SQLite-based job queue for ARI updates
 * 
 * Manages pending sync jobs (inventory, rates, restrictions) that need
 * to be pushed to connected channels. Jobs are created when pricing or
 * bookings change in PMS, and processed by the cron-callable sync endpoint.
 */

import { getDb } from '@/lib/db';
import type { SyncType, SyncJobStatus } from './types';

function generateJobId(): string {
  return `sq_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ─── Enqueue ─────────────────────────────────────────────────

/**
 * Add a sync job to the queue.
 * Automatically deduplicates — if a pending job for the same connection/type/unit/dates
 * already exists, it won't create a duplicate.
 */
export function enqueueSync(params: {
  connectionId: string;
  syncType: SyncType;
  unitTypeId?: string | null;
  dateFrom: string;
  dateTo: string;
  priority?: number;
}): string | null {
  const db = getDb();
  const priority = params.priority ?? 5;

  // Check for duplicate pending job
  const existing = db.prepare(`
    SELECT id FROM ari_sync_queue
    WHERE connection_id = ? AND sync_type = ? AND status = 'pending'
      AND (unit_type_id = ? OR (unit_type_id IS NULL AND ? IS NULL))
      AND date_from = ? AND date_to = ?
  `).get(
    params.connectionId, params.syncType,
    params.unitTypeId ?? null, params.unitTypeId ?? null,
    params.dateFrom, params.dateTo
  ) as { id: string } | undefined;

  if (existing) {
    return existing.id; // Already queued
  }

  const id = generateJobId();
  db.prepare(`
    INSERT INTO ari_sync_queue (id, connection_id, sync_type, unit_type_id,
      date_from, date_to, status, priority)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, params.connectionId, params.syncType, params.unitTypeId ?? null,
    params.dateFrom, params.dateTo, priority);

  return id;
}

/**
 * Enqueue sync jobs for ALL active connections when pricing or availability changes.
 * This is called from pricing and booking API routes.
 */
export function enqueueForAllConnections(params: {
  syncType: SyncType;
  unitTypeId?: string | null;
  dateFrom: string;
  dateTo: string;
  priority?: number;
}): number {
  const db = getDb();
  const connections = db.prepare(`
    SELECT id FROM channel_connections WHERE status = 'connected'
  `).all() as Array<{ id: string }>;

  let queued = 0;
  for (const conn of connections) {
    const id = enqueueSync({
      connectionId: conn.id,
      syncType: params.syncType,
      unitTypeId: params.unitTypeId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      priority: params.priority,
    });
    if (id) queued++;
  }

  return queued;
}

// ─── Dequeue ─────────────────────────────────────────────────

/**
 * Get the next pending job from the queue (highest priority, oldest first).
 * Marks it as 'processing'.
 */
export function dequeueJob(): {
  id: string;
  connection_id: string;
  sync_type: SyncType;
  unit_type_id: string | null;
  date_from: string;
  date_to: string;
  attempts: number;
  max_attempts: number;
} | null {
  const db = getDb();

  const job = db.prepare(`
    SELECT * FROM ari_sync_queue
    WHERE status = 'pending'
    ORDER BY priority ASC, created_at ASC
    LIMIT 1
  `).get() as Record<string, unknown> | undefined;

  if (!job) return null;

  // Mark as processing
  db.prepare(`
    UPDATE ari_sync_queue
    SET status = 'processing', attempts = attempts + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(job.id);

  return {
    id: job.id as string,
    connection_id: job.connection_id as string,
    sync_type: job.sync_type as SyncType,
    unit_type_id: (job.unit_type_id as string) || null,
    date_from: job.date_from as string,
    date_to: job.date_to as string,
    attempts: (job.attempts as number) + 1,
    max_attempts: job.max_attempts as number,
  };
}

// ─── Status Updates ──────────────────────────────────────────

/**
 * Mark a job as completed.
 */
export function markCompleted(jobId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE ari_sync_queue SET status = 'completed', updated_at = datetime('now')
    WHERE id = ?
  `).run(jobId);
}

/**
 * Mark a job as failed. If under max_attempts, re-queue as pending.
 */
export function markFailed(jobId: string, error: string): void {
  const db = getDb();
  const job = db.prepare('SELECT attempts, max_attempts FROM ari_sync_queue WHERE id = ?')
    .get(jobId) as { attempts: number; max_attempts: number } | undefined;

  if (job && job.attempts < job.max_attempts) {
    // Re-queue with lower priority (delay retry)
    db.prepare(`
      UPDATE ari_sync_queue
      SET status = 'pending', last_error = ?, priority = priority + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(error, jobId);
  } else {
    // Permanently failed
    db.prepare(`
      UPDATE ari_sync_queue
      SET status = 'failed', last_error = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(error, jobId);
  }
}

// ─── Queue Stats ─────────────────────────────────────────────

/**
 * Get queue statistics for monitoring dashboard.
 */
export function getQueueStats(): {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
} {
  const db = getDb();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as cnt FROM ari_sync_queue
    GROUP BY status
  `).all() as Array<{ status: SyncJobStatus; cnt: number }>;

  const stats = { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };
  for (const row of rows) {
    stats[row.status] = row.cnt;
    stats.total += row.cnt;
  }
  return stats;
}

/**
 * Get recent failed jobs (for error dashboard).
 */
export function getFailedJobs(limit: number = 20): unknown[] {
  const db = getDb();
  return db.prepare(`
    SELECT sq.*, cc.channel, cc.external_property_id
    FROM ari_sync_queue sq
    JOIN channel_connections cc ON sq.connection_id = cc.id
    WHERE sq.status = 'failed'
    ORDER BY sq.updated_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Clear completed jobs older than N days (cleanup).
 */
export function cleanupOldJobs(olderThanDays: number = 7): number {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const cutoffStr = cutoff.toISOString();

  const result = db.prepare(`
    DELETE FROM ari_sync_queue
    WHERE status = 'completed' AND updated_at < ?
  `).run(cutoffStr);

  return result.changes;
}
