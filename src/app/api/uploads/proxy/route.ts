import { NextResponse } from 'next/server';

/**
 * Disabled: this took any posted file and uploaded it to catbox.moe, falling
 * back to pixeldrain — public, anonymous, permanent file hosts — and returned
 * the resulting public URL. In a system that holds passport scans and guest
 * registration documents that is an exfiltration path, and it had no session
 * check, so any logged-in user of any hotel could use it.
 *
 * Nothing in the codebase calls it. It answers 410 rather than being deleted
 * outright so an unnoticed caller fails loudly instead of silently losing its
 * upload; use /api/file-upload, which writes to the server's own storage.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint is disabled. Use /api/file-upload.', code: 'GONE' },
    { status: 410 },
  );
}
