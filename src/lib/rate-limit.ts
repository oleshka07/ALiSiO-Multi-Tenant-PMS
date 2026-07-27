/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '@/lib/db';

/**
 * Check rate limit for a given token + action.
 * Returns { allowed: boolean, remaining: number }
 */
export function checkRateLimit(
  token: string,
  action: 'service_order' | 'registration',
  maxRequests: number,
  windowMinutes: number
): { allowed: boolean; remaining: number } {
  const db = getDb();

  // Count recent requests within the window
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const count = (db.prepare(
    'SELECT COUNT(*) as cnt FROM rate_limits WHERE token = ? AND action = ? AND created_at > ?'
  ).get(token, action, cutoff) as any)?.cnt || 0;

  if (count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  // Record this request
  db.prepare(
    'INSERT INTO rate_limits (token, action) VALUES (?, ?)'
  ).run(token, action);

  return { allowed: true, remaining: maxRequests - count - 1 };
}
