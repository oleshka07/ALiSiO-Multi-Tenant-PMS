/**
 * Rate Limiter — enforces Booking.com API rate limits
 * 
 * Uses in-memory counters with per-endpoint limits.
 * Implements exponential backoff on 429 responses.
 */

import { BOOKING_COM_RATE_LIMITS } from './types';

interface EndpointCounter {
  count: number;
  windowStart: number; // timestamp ms
  windowMs: number;    // window size in ms
}

// In-memory counters (reset on server restart, which is acceptable)
const counters = new Map<string, EndpointCounter>();

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Check if a request to the given endpoint is allowed.
 * Returns { allowed: true } or { allowed: false, retryAfterMs }
 */
export function checkRateLimit(endpoint: string): {
  allowed: boolean;
  retryAfterMs?: number;
  currentCount?: number;
  limit?: number;
} {
  const limit = getEndpointLimit(endpoint);
  const isHourly = endpoint === 'token-exchange';
  const windowMs = isHourly ? HOUR_MS : MINUTE_MS;
  const key = normalizeEndpoint(endpoint);

  let counter = counters.get(key);
  const now = Date.now();

  // Reset window if expired
  if (!counter || now - counter.windowStart >= counter.windowMs) {
    counter = { count: 0, windowStart: now, windowMs };
    counters.set(key, counter);
  }

  if (counter.count >= limit) {
    const retryAfterMs = counter.windowMs - (now - counter.windowStart);
    return {
      allowed: false,
      retryAfterMs: Math.max(retryAfterMs, 1000),
      currentCount: counter.count,
      limit,
    };
  }

  return { allowed: true, currentCount: counter.count, limit };
}

/**
 * Record that a request was made to the given endpoint.
 * Call this AFTER a successful request.
 */
export function recordRequest(endpoint: string): void {
  const key = normalizeEndpoint(endpoint);
  const isHourly = endpoint === 'token-exchange';
  const windowMs = isHourly ? HOUR_MS : MINUTE_MS;
  const now = Date.now();

  let counter = counters.get(key);
  if (!counter || now - counter.windowStart >= counter.windowMs) {
    counter = { count: 0, windowStart: now, windowMs };
    counters.set(key, counter);
  }

  counter.count++;

  // Alert at 80% of limit
  const limit = getEndpointLimit(endpoint);
  if (counter.count >= limit * 0.8) {
    console.warn(`[Rate Limiter] ⚠️ ${key}: ${counter.count}/${limit} (${Math.round(counter.count / limit * 100)}%) — approaching limit`);
  }
}

/**
 * Calculate exponential backoff delay for retry attempts.
 * Used when receiving HTTP 429 responses.
 */
export function getBackoffDelay(attempt: number, baseDelayMs: number = 1000): number {
  // Exponential backoff with jitter: base * 2^attempt + random jitter
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs;
  return Math.min(exponential + jitter, 60000); // cap at 60 seconds
}

/**
 * Wait for the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with rate limiting and retries.
 * Automatically handles 429 responses with exponential backoff.
 */
export async function withRateLimit<T>(
  endpoint: string,
  fn: () => Promise<T>,
  maxRetries: number = 3,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check rate limit before making request
    const check = checkRateLimit(endpoint);
    if (!check.allowed) {
      console.log(`[Rate Limiter] Waiting ${check.retryAfterMs}ms for ${endpoint} (${check.currentCount}/${check.limit})`);
      await sleep(check.retryAfterMs!);
      continue;
    }

    try {
      const result = await fn();
      recordRequest(endpoint);
      return result;
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      if (status === 429 && attempt < maxRetries) {
        const delay = getBackoffDelay(attempt);
        console.warn(`[Rate Limiter] 429 received for ${endpoint}, backing off ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Rate limit exceeded after ${maxRetries} retries for ${endpoint}`);
}

// ─── Helpers ─────────────────────────────────────────────────

function normalizeEndpoint(endpoint: string): string {
  // Extract the path portion for matching against rate limit config
  for (const key of Object.keys(BOOKING_COM_RATE_LIMITS)) {
    if (key !== 'default' && endpoint.includes(key)) {
      return key;
    }
  }
  return 'default';
}

function getEndpointLimit(endpoint: string): number {
  const key = normalizeEndpoint(endpoint);
  return BOOKING_COM_RATE_LIMITS[key] || BOOKING_COM_RATE_LIMITS['default'];
}

/**
 * Get current rate limit stats (for monitoring dashboard)
 */
export function getRateLimitStats(): Array<{
  endpoint: string;
  currentCount: number;
  limit: number;
  percentUsed: number;
  windowResetMs: number;
}> {
  const now = Date.now();
  const stats: Array<{
    endpoint: string;
    currentCount: number;
    limit: number;
    percentUsed: number;
    windowResetMs: number;
  }> = [];

  for (const [key, counter] of counters.entries()) {
    const elapsed = now - counter.windowStart;
    if (elapsed < counter.windowMs) {
      const limit = BOOKING_COM_RATE_LIMITS[key] || BOOKING_COM_RATE_LIMITS['default'];
      stats.push({
        endpoint: key,
        currentCount: counter.count,
        limit,
        percentUsed: Math.round(counter.count / limit * 100),
        windowResetMs: counter.windowMs - elapsed,
      });
    }
  }

  return stats;
}
