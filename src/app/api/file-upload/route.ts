/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { withActor, type Actor } from '@core/auth/session';
import { uploadDirFor, uploadUrl, safeFilename } from '@core/storage/uploads';

/**
 * POST /api/file-upload — dashboard image upload.
 *
 * Requires a session. This route was exempted from the middleware for the
 * retired public booking wizard, which left an open upload endpoint behind.
 *
 * The file lands under the uploader's organization, because that path is what
 * `GET /api/uploads/...` checks ownership with. The random suffix replaces
 * `Date.now()`: a millisecond is guessable in a range, and these are guest
 * passports and bank statements.
 */
async function uploadHandler(request: NextRequest, actor: Actor) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const folder = (formData.get('folder') as string) || 'general';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type — accept iPhone HEIC/HEIF too (the booking widget
    // resizes them to JPEG client-side, but admin uploads via /settings may
    // skip that step).
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
      'image/heic', 'image/heif',
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: `Invalid file type "${file.type}". Allowed: jpg, png, webp, gif, svg, heic` }, { status: 400 });
    }

    // Max size 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Max 10MB' }, { status: 400 });
    }

    const dir = uploadDirFor(actor.organizationId, folder);
    const filename = safeFilename(file.name, crypto.randomBytes(8).toString('hex'));

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(path.join(dir, filename), buffer);

    const url = uploadUrl(actor.organizationId, folder, filename);
    return NextResponse.json({ url, filename, size: file.size });
  } catch (error: any) {
    console.error('POST /api/file-upload error:', error?.message);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

export const POST = withActor((req, _ctx, actor: Actor) => uploadHandler(req as NextRequest, actor));
