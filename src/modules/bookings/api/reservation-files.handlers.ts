/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { getSql } from '@core/db/async';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { uploadDirFor, uploadUrl, resolveUploadPath, safeFilename } from '@core/storage/uploads';
import { serverError } from '@core/http/errors';
import { ownedReservation } from '../data/owned.repo';

/**
 * Вкладення до броні — вкладка «Файли» картки (Блок 4, 0090).
 *
 * Файл лежить у тому ж сховищі, що й решта вкладень готелю
 * (`data/uploads/<org>/reservations/…`), і читається тим самим
 * `GET /api/uploads`, який звіряє організацію в шляху. Рядок у
 * `reservation_files` каже, до якої броні він належить і хто його поклав;
 * `organization_id` названо явно (інваріант 12).
 *
 * Скани документів і підтвердження — це PDF так само часто, як фото, тому
 * на відміну від `api/file-upload` тут PDF дозволено.
 */
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'application/pdf',
]);
const MAX_BYTES = 10 * 1024 * 1024;
const FOLDER = 'reservations';
const KINDS = new Set(['document', 'photo', 'other']);

type IdParams = { params: Promise<{ id: string }> };
type FileParams = { params: Promise<{ id: string; fileId: string }> };

const LIST_SQL = `
  SELECT f.id, f.reservation_id, f.kind, f.path, f.original_name, f.mime_type, f.size_bytes,
         f.uploaded_by, f.created_at, u.full_name AS uploaded_by_name
    FROM reservation_files f
    LEFT JOIN app_users u ON u.id = f.uploaded_by
   WHERE f.organization_id = ? AND f.reservation_id = ?
   ORDER BY f.created_at DESC`;

export const listReservationFiles = withActor(async (_request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    if (!await ownedReservation(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const files = await getSql().rows<any>(LIST_SQL, [actor.organizationId, id]);
    return NextResponse.json({ files });
  } catch (e) {
    return serverError('modules/bookings/api/reservation-files listReservationFiles', e, 'Failed to list files');
  }
});

export const uploadReservationFile = withPermission('manage_bookings', async (request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    if (!await ownedReservation(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const kindRaw = String(formData.get('kind') || 'other');
    const kind = KINDS.has(kindRaw) ? kindRaw : 'other';
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'unsupported_type', allowed: [...ALLOWED_TYPES] }, { status: 400 });
    }
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file_too_large', max: MAX_BYTES }, { status: 400 });

    const dir = uploadDirFor(actor.organizationId, FOLDER);
    const filename = safeFilename(file.name, crypto.randomBytes(8).toString('hex'));
    fs.writeFileSync(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));
    const url = uploadUrl(actor.organizationId, FOLDER, filename);

    const fileId = crypto.randomUUID();
    await getSql().run(
      `INSERT INTO reservation_files
         (id, organization_id, reservation_id, kind, path, original_name, mime_type, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fileId, actor.organizationId, id, kind, url, file.name.slice(0, 200), file.type, file.size, actor.user.id],
    );
    const row = await getSql().row<any>(
      `SELECT f.id, f.reservation_id, f.kind, f.path, f.original_name, f.mime_type, f.size_bytes,
              f.uploaded_by, f.created_at, u.full_name AS uploaded_by_name
         FROM reservation_files f
         LEFT JOIN app_users u ON u.id = f.uploaded_by
        WHERE f.id = ? AND f.organization_id = ?`,
      [fileId, actor.organizationId]);
    return NextResponse.json(row ?? { id: fileId }, { status: 201 });
  } catch (e) {
    return serverError('modules/bookings/api/reservation-files uploadReservationFile', e, 'Upload failed');
  }
});

export const deleteReservationFile = withPermission('manage_bookings', async (_request: NextRequest, { params }: FileParams, actor: Actor) => {
  try {
    const { id, fileId } = await params;
    if (!await ownedReservation(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const sql = getSql();
    const row = await sql.row<any>(
      'SELECT id, path FROM reservation_files WHERE id = ? AND reservation_id = ? AND organization_id = ?',
      [fileId, id, actor.organizationId]);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await sql.run('DELETE FROM reservation_files WHERE id = ? AND organization_id = ?', [fileId, actor.organizationId]);
    // Файл — після рядка: рядок без файла показує «немає», файл без рядка
    // нікому не видний. Шлях зберігається як адреса `/api/uploads/<org>/…`,
    // тож організація звіряється ще раз тим самим резолвером, що при читанні.
    const segments = String(row.path).replace(/^\/api\/uploads\//, '').split('/');
    const full = resolveUploadPath(actor.organizationId, segments);
    if (full) { try { fs.unlinkSync(full); } catch { /* уже немає */ } }
    return NextResponse.json({ success: true });
  } catch (e) {
    return serverError('modules/bookings/api/reservation-files deleteReservationFile', e, 'Failed to delete file');
  }
});
