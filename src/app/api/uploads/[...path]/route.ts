/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { withActor } from '@core/auth/session';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

// GET /api/uploads/[...path] — serve uploaded files
//
// These are guest documents, bank statements and registration scans. Served
// without a session, a guessed or leaked filename was enough to read any
// hotel's file, and the response asked browsers and proxies to cache it
// publicly for a year.
export const GET = withActor(async (_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) => {
  try {
    const { path: segments } = await params;
    const filePath = path.join(UPLOAD_DIR, ...segments);

    // Security: prevent directory traversal
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const buffer = fs.readFileSync(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
      '.heic': 'image/heic', '.heif': 'image/heif',
      '.pdf': 'application/pdf',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

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
})
