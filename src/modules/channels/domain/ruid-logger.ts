/**
 * RUID Logger — logs all Booking.com API requests/responses
 * 
 * Every Booking.com API response includes a unique RUID (Request Unique ID).
 * This logger stores all communications for debugging and certification.
 */

import { getDb } from '@core/db';
import type { SyncDirection } from './types';
import { getSql } from '@core/db/async';

const MAX_BODY_LENGTH = 10240; // 10KB truncation for stored bodies

function truncate(text: string | null | undefined): string | null {
  if (!text) return null;
  if (text.length <= MAX_BODY_LENGTH) return text;
  return text.substring(0, MAX_BODY_LENGTH) + `\n... [TRUNCATED, total ${text.length} bytes]`;
}

function generateLogId(): string {
  return `sl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Log an API request/response to ari_sync_log table
 */
export async function logSyncRequest(params: {
  connectionId: string;
  direction: SyncDirection;
  endpoint: string;
  requestBody?: string | null;
  responseStatus?: number | null;
  responseBody?: string | null;
  ruid?: string | null;
  durationMs?: number | null;
}): Promise<string> {
  const sql = getSql();
  const id = generateLogId();

  try {
    await sql.run(`
      INSERT INTO ari_sync_log (id, connection_id, direction, endpoint,
        request_body, response_status, response_body, ruid, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      params.connectionId,
      params.direction,
      params.endpoint,
      truncate(params.requestBody),
      params.responseStatus ?? null,
      truncate(params.responseBody),
      params.ruid ?? null,
      params.durationMs ?? null]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[RUID Logger] Failed to log:', msg);
  }

  return id;
}

/**
 * Extract RUID from response headers (Booking.com specific)
 */
export function extractRUID(headers: Headers): string | null {
  // Booking.com returns RUID in various header formats
  return headers.get('x-request-id')
    || headers.get('ruid')
    || headers.get('x-booking-ruid')
    || null;
}

/**
 * Get recent sync logs for a connection
 */
export async function getSyncLogs(connectionId: string, limit: number = 50): Promise<unknown[]> {
  const sql = getSql();
  return await sql.rows<any>(`
    SELECT * FROM ari_sync_log
    WHERE connection_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [connectionId, limit]);
}

/**
 * Get all sync logs (across connections) for a date range
 */
export async function getAllSyncLogs(params: {
  dateFrom?: string;
  dateTo?: string;
  direction?: SyncDirection;
  limit?: number;
}): Promise<unknown[]> {
  const sql = getSql();
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.dateFrom) {
    conditions.push('created_at >= ?');
    values.push(params.dateFrom);
  }
  if (params.dateTo) {
    conditions.push('created_at <= ?');
    values.push(params.dateTo + 'T23:59:59');
  }
  if (params.direction) {
    conditions.push('direction = ?');
    values.push(params.direction);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(params.limit || 100);

  return await sql.rows<any>(`
    SELECT sl.*, cc.channel, cc.external_property_id
    FROM ari_sync_log sl
    JOIN channel_connections cc ON sl.connection_id = cc.id
    ${where}
    ORDER BY sl.created_at DESC
    LIMIT ?
  `, [...values]);
}
