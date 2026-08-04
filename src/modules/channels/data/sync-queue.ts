/**
 * Sync Queue — SQLite-based job queue for ARI updates
 * 
 * Manages pending sync jobs (inventory, rates, restrictions) that need
 * to be pushed to connected channels. Jobs are created when pricing or
 * bookings change in PMS, and processed by the cron-callable sync endpoint.
 */

import { getDb } from '@core/db';
import type { SyncType, SyncJobStatus } from '../domain/types';
import { getSql } from '@core/db/async';

function generateJobId(): string {
  return `sq_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ─── Enqueue ─────────────────────────────────────────────────

/**
 * Add a sync job to the queue.
 * Automatically deduplicates — if a pending job for the same connection/type/unit/dates
 * already exists, it won't create a duplicate.
 */
export async function enqueueSync(params: {
  connectionId: string;
  syncType: SyncType;
  unitTypeId?: string | null;
  dateFrom: string;
  dateTo: string;
  priority?: number;
}): Promise<string | null> {
  const sql = getSql();
  const priority = params.priority ?? 5;

  // Check for duplicate pending job
  const existing = await sql.row<any>(`
    SELECT id FROM ari_sync_queue
    WHERE connection_id = ? AND sync_type = ? AND status = 'pending'
      AND (unit_type_id = ? OR (unit_type_id IS NULL AND ? IS NULL))
      AND date_from = ? AND date_to = ?
  `, [params.connectionId, params.syncType,
    params.unitTypeId ?? null, params.unitTypeId ?? null,
    params.dateFrom, params.dateTo]) as { id: string } | undefined;

  if (existing) {
    return existing.id; // Already queued
  }

  const id = generateJobId();
  await sql.run(`
    INSERT INTO ari_sync_queue (id, connection_id, sync_type, unit_type_id,
      date_from, date_to, status, priority)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `, [id, params.connectionId, params.syncType, params.unitTypeId ?? null,
    params.dateFrom, params.dateTo, priority]);

  return id;
}

/**
 * Enqueue sync jobs for ALL active connections when pricing or availability changes.
 * This is called from pricing and booking API routes.
 */
export async function enqueueForAllConnections(params: {
  syncType: SyncType;
  unitTypeId?: string | null;
  dateFrom: string;
  dateTo: string;
  priority?: number;
}): Promise<number> {
  const sql = getSql();
  const connections = await sql.rows<any>(`
    SELECT id FROM channel_connections WHERE status = 'connected'
  `) as Array<{ id: string }>;

  let queued = 0;
  for (const conn of connections) {
    const id = await enqueueSync({
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
export async function dequeueJob(): Promise<{
  id: string;
  connection_id: string;
  sync_type: SyncType;
  unit_type_id: string | null;
  date_from: string;
  date_to: string;
  attempts: number;
  max_attempts: number;
} | null> {
  const sql = getSql();

  const job = await sql.row<any>(`
    SELECT * FROM ari_sync_queue
    WHERE status = 'pending'
    ORDER BY priority ASC, created_at ASC
    LIMIT 1
  `) as Record<string, unknown> | undefined;

  if (!job) return null;

  // Mark as processing
  await sql.run(`
    UPDATE ari_sync_queue
    SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [job.id]);

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
export async function markCompleted(jobId: string): Promise<void> {
  const sql = getSql();
  await sql.run(`
    UPDATE ari_sync_queue SET status = 'completed', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [jobId]);
}

/**
 * Mark a job as failed. If under max_attempts, re-queue as pending.
 */
export async function markFailed(jobId: string, error: string): Promise<void> {
  const sql = getSql();
  const job = await sql.row<any>('SELECT attempts, max_attempts FROM ari_sync_queue WHERE id = ?', [jobId]) as { attempts: number; max_attempts: number } | undefined;

  if (job && job.attempts < job.max_attempts) {
    // Re-queue with lower priority (delay retry)
    await sql.run(`
      UPDATE ari_sync_queue
      SET status = 'pending', last_error = ?, priority = priority + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [error, jobId]);
  } else {
    // Permanently failed
    await sql.run(`
      UPDATE ari_sync_queue
      SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [error, jobId]);
  }
}

// ─── Queue Stats ─────────────────────────────────────────────

/**
 * Get queue statistics for monitoring dashboard.
 */
export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}> {
  const sql = getSql();
  const rows = await sql.rows<any>(`
    SELECT status, COUNT(*) as cnt FROM ari_sync_queue
    GROUP BY status
  `) as Array<{ status: SyncJobStatus; cnt: number }>;

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
export async function getFailedJobs(limit: number = 20): Promise<unknown[]> {
  const sql = getSql();
  return await sql.rows<any>(`
    SELECT sq.*, cc.channel, cc.external_property_id
    FROM ari_sync_queue sq
    JOIN channel_connections cc ON sq.connection_id = cc.id
    WHERE sq.status = 'failed'
    ORDER BY sq.updated_at DESC
    LIMIT ?
  `, [limit]);
}

/**
 * Clear completed jobs older than N days (cleanup).
 */
export async function cleanupOldJobs(olderThanDays: number = 7): Promise<number> {
  const sql = getSql();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const cutoffStr = cutoff.toISOString();

  const result = await sql.run(`
    DELETE FROM ari_sync_queue
    WHERE status = 'completed' AND updated_at < ?
  `, [cutoffStr]);

  return result.changes;
}
