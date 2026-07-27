/**
 * Booking.com JWT Authentication Client
 * 
 * Handles token fetching, caching, and auto-refresh.
 * Token lifetime: 1 hour. Max 30 tokens/hour per machine account.
 * Auto-refreshes 5 minutes before expiry.
 */

import { getDb } from '@/lib/db';
import { withRateLimit } from './rate-limiter';
import { logSyncRequest, extractRUID } from './ruid-logger';
import { BOOKING_COM_URLS } from './types';
import type { EnvironmentType } from './types';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

/**
 * Get a valid access token for the given connection.
 * Returns cached token if still valid, otherwise fetches a new one.
 */
export async function getAccessToken(connectionId: string): Promise<string> {
  const db = getDb();

  // Get connection and its credentials
  const conn = db.prepare(`
    SELECT cc.*, cred.id as cred_id, cred.client_id, cred.client_secret,
           cred.access_token, cred.token_expires_at, cred.environment
    FROM channel_connections cc
    JOIN channel_credentials cred ON cc.credentials_id = cred.id
    WHERE cc.id = ?
  `).get(connectionId) as Record<string, unknown> | undefined;

  if (!conn) {
    throw new Error(`Connection ${connectionId} not found or has no credentials`);
  }
  if (!conn.client_id || !conn.client_secret) {
    throw new Error(`Connection ${connectionId}: client_id and client_secret are required`);
  }

  // Check if cached token is still valid
  if (conn.access_token && conn.token_expires_at) {
    const expiresAt = new Date(conn.token_expires_at as string).getTime();
    const now = Date.now();
    if (expiresAt - now > TOKEN_REFRESH_BUFFER_MS) {
      return conn.access_token as string;
    }
  }

  // Fetch new token
  const token = await fetchNewToken(
    connectionId,
    conn.client_id as string,
    conn.client_secret as string,
    conn.cred_id as string,
    (conn.environment as EnvironmentType) || 'test',
  );

  return token;
}

/**
 * Force refresh the token for a connection (e.g., after a 401 response)
 */
export async function refreshToken(connectionId: string): Promise<string> {
  const db = getDb();

  // Clear cached token
  db.prepare(`
    UPDATE channel_credentials SET access_token = NULL, token_expires_at = NULL,
    updated_at = datetime('now')
    WHERE id = (SELECT credentials_id FROM channel_connections WHERE id = ?)
  `).run(connectionId);

  return getAccessToken(connectionId);
}

/**
 * Fetch a new JWT from Booking.com authentication endpoint
 */
async function fetchNewToken(
  connectionId: string,
  clientId: string,
  clientSecret: string,
  credentialsId: string,
  environment: EnvironmentType,
): Promise<string> {
  const baseUrl = BOOKING_COM_URLS[environment].auth;
  const endpoint = `${baseUrl}/token-based-authentication/exchange`;

  const startTime = Date.now();
  let ruid: string | null = null;
  let responseStatus: number | undefined;
  let responseBody: string | undefined;

  try {
    const result = await withRateLimit('token-exchange', async () => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      responseStatus = res.status;
      ruid = extractRUID(res.headers);
      responseBody = await res.text();

      if (!res.ok) {
        const error = new Error(`Token exchange failed: HTTP ${res.status}`);
        (error as unknown as Record<string, number>).status = res.status;
        throw error;
      }

      return JSON.parse(responseBody) as { jwt: string; ruid: string };
    });

    // Store token — expires in 1 hour
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const db = getDb();
    db.prepare(`
      UPDATE channel_credentials
      SET access_token = ?, token_expires_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(result.jwt, expiresAt, credentialsId);

    console.log(`[Auth] Token refreshed for connection ${connectionId}, expires at ${expiresAt}`);

    return result.jwt;
  } finally {
    // Always log the request, success or failure
    logSyncRequest({
      connectionId,
      direction: 'outbound',
      endpoint: '/token-based-authentication/exchange',
      requestBody: JSON.stringify({ client_id: clientId, client_secret: '[REDACTED]' }),
      responseStatus: responseStatus ?? null,
      responseBody: responseBody ?? null,
      ruid,
      durationMs: Date.now() - startTime,
    });
  }
}

/**
 * Make an authenticated HTTP request to Booking.com API.
 * Automatically handles token refresh on 401.
 */
export async function authenticatedFetch(
  connectionId: string,
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken(connectionId);

  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Auto-refresh on 401 and retry ONCE
  if (response.status === 401) {
    console.warn(`[Auth] 401 received, refreshing token for connection ${connectionId}`);
    const newToken = await refreshToken(connectionId);

    headers.set('Authorization', `Bearer ${newToken}`);
    return fetch(url, {
      ...options,
      headers,
    });
  }

  return response;
}

/**
 * Get credentials status for diagnostics (never exposes secrets)
 */
export function getCredentialsStatus(connectionId: string): {
  hasCredentials: boolean;
  hasToken: boolean;
  tokenExpiresAt: string | null;
  tokenValid: boolean;
  environment: string | null;
} {
  const db = getDb();
  const conn = db.prepare(`
    SELECT cred.client_id, cred.access_token, cred.token_expires_at, cred.environment
    FROM channel_connections cc
    JOIN channel_credentials cred ON cc.credentials_id = cred.id
    WHERE cc.id = ?
  `).get(connectionId) as Record<string, unknown> | undefined;

  if (!conn) {
    return { hasCredentials: false, hasToken: false, tokenExpiresAt: null, tokenValid: false, environment: null };
  }

  const tokenExpiresAt = conn.token_expires_at as string | null;
  const tokenValid = !!(tokenExpiresAt && new Date(tokenExpiresAt).getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS);

  return {
    hasCredentials: !!(conn.client_id),
    hasToken: !!(conn.access_token),
    tokenExpiresAt,
    tokenValid,
    environment: conn.environment as string | null,
  };
}
