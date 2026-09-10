import { cookies } from 'next/headers';
import { PLATFORM_COOKIE } from '@core/auth/platform';
import { platformAppsReport } from './_report';

/**
 * GET /api/platform/apps — стан застосунків усіх готелів і попит «хочу».
 * Лише платформна сесія; своя кука, свої таблиці (ARCHITECTURE §3.3).
 */
export async function GET() {
  const store = await cookies();
  return platformAppsReport(store.get(PLATFORM_COOKIE)?.value);
}
