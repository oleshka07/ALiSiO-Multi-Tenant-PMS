/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { withActor, type Actor } from '@core/auth/session';
import { resolveUploadPath, UPLOAD_MIME } from '@core/storage/uploads';

/**
 * GET /api/uploads/[...path] — serve an uploaded file to the hotel that owns it.
 *
 * These are guest documents, bank statements and registration scans. The route
 * checked that there WAS a session and then served the bytes: it had nothing
 * else to check, because the stored path said nothing about which hotel the
 * file belonged to. Any logged-in user of any hotel could read any other's,
 * and `${name}_${Date.now()}` is guessable enough that this was a sweep, not a
 * lucky hit.
 *
 * The organization is now the first path segment, and the actor's own id is
 * what builds the path that gets read — so a file belonging to somebody else
 * cannot be addressed, rather than being addressable and refused.
 */
export const GET = withActor(async (
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
  actor: Actor,
) => {
  try {
    const { path: segments } = await params;
    const resolved = resolveUploadPath(actor.organizationId, segments || []);

    // 404 rather than 403: a 403 confirms the file exists, which is half of
    // what anyone probing for another hotel's scans is after.
    if (!resolved) return NextResponse.json({ error: 'File not found' }, { status: 404 });

    const buffer = fs.readFileSync(resolved);
    const contentType = UPLOAD_MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    console.error('GET /api/uploads error:', error?.message);
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 });
  }
});
