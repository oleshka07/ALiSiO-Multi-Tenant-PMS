/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '@/lib/db';
import { getSql } from '../db/async.ts';

/**
 * Check rate limit for a given token + action.
 * Returns { allowed: boolean, remaining: number }
 */
export async function checkRateLimit(
  token: string,
  action: 'service_order' | 'registration',
  maxRequests: number,
  windowMinutes: number
): Promise<{ allowed: boolean; remaining: number }> {
  const sql = getSql();

  // Count recent requests within the window
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const count = (await sql.row<any>('SELECT COUNT(*) as cnt FROM rate_limits WHERE token = ? AND action = ? AND created_at > ?', [token, action, cutoff]) as any)?.cnt || 0;

  if (count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  // Record this request
  await sql.run('INSERT INTO rate_limits (token, action) VALUES (?, ?)', [token, action]);

  return { allowed: true, remaining: maxRequests - count - 1 };
}
