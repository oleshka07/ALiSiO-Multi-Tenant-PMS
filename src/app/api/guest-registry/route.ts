import { getRegistry, exportRegistry } from '@/modules/guests/api/registry.handlers';
import { NextRequest } from 'next/server';

// Both are guarded in the handler; the context is what the guard passes on.
export async function GET(request: NextRequest, context: { params: Promise<Record<string, never>> }) {
  const format = request.nextUrl.searchParams.get('format');
  if (format === 'csv') return exportRegistry(request, context);
  return getRegistry(request, context);
}
