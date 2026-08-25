import path from 'node:path';
import fs from 'node:fs';

/**
 * Where an uploaded file lives, and whose it is.
 *
 * It used to be `data/uploads/<folder>/<name>`, with the name built as
 * `${baseName}_${Date.now()}${ext}` — the guest's own file name plus a
 * millisecond. Nothing in that path says which hotel the file belongs to, so
 * `GET /api/uploads/...` had nothing to check against: it verified there was a
 * session and served the bytes. Any logged-in user of any hotel could read any
 * other hotel's guest passports, bank statements and registration scans, and
 * the name was guessable enough to make that a sweep rather than a lucky hit.
 *
 * The organization is now the first path segment. That is the whole fix and it
 * is deliberately stateless: no lookup table to fall out of sync with the disk,
 * no ownership column to forget on a new upload path. A request for a file the
 * actor's organization does not own cannot be satisfied, because the actor's
 * own id is what builds the path that gets read.
 *
 * 404, never 403, when the organization does not match: 403 confirms the file
 * exists, which is half of what the attacker wanted.
 */
export const UPLOAD_ROOT = path.join(process.cwd(), 'data', 'uploads');

/** Folder names are ours, but they arrive in a form field — keep them tame. */
export function safeSegment(value: string, fallback: string): string {
  const clean = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return clean.length ? clean.slice(0, 64) : fallback;
}

/** A file name that cannot escape its folder and cannot collide by guessing. */
export function safeFilename(originalName: string, randomSuffix: string): string {
  const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.jpg';
  const base = path.basename(originalName, path.extname(originalName))
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 50) || 'file';
  return `${base}_${randomSuffix}${ext}`;
}

/** The directory this organization's files go in, created if needed. */
export function uploadDirFor(organizationId: string, folder: string): string {
  const dir = path.join(UPLOAD_ROOT, safeSegment(organizationId, 'unknown'), safeSegment(folder, 'general'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The URL the browser asks for. Mirrors uploadDirFor exactly. */
export function uploadUrl(organizationId: string, folder: string, filename: string): string {
  return `/api/uploads/${safeSegment(organizationId, 'unknown')}/${safeSegment(folder, 'general')}/${filename}`;
}

/**
 * Resolve a request path to a file this organization may read, or null.
 *
 * Two ways to get null, and they are the same answer to the caller on purpose:
 * the path escapes the upload root (traversal), or its first segment is not
 * this organization. A legacy path — one with no organization segment, written
 * before this change — is also null: those files are moved into place by
 * `scripts/migrate-uploads.mjs`, and serving them meanwhile would keep exactly
 * the hole this exists to close.
 */
export function resolveUploadPath(organizationId: string, segments: string[]): string | null {
  if (!segments.length) return null;
  const org = safeSegment(organizationId, 'unknown');
  if (segments[0] !== org) return null;

  const full = path.resolve(path.join(UPLOAD_ROOT, ...segments));
  if (!full.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

export const UPLOAD_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.pdf': 'application/pdf',
};
