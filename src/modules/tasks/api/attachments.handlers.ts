/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { getDb } from '@core/db';
import { withPermission, notFound, type Actor } from '@core/auth/session';

/**
 * Files attached to a task.
 *
 * This lived in the route file and wrote SQL against the tasks table from
 * outside the module — the reach that makes a module impossible to lift out.
 * It was also unscoped in all three directions: GET listed attachments for any
 * task id, POST attached a file to any task, and DELETE removed any attachment
 * by id. GET and DELETE did not look at the session at all.
 */

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads', 'tasks');

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
  'image/heic', 'image/heif',
  'application/pdf',
];
const MAX_BYTES = 10 * 1024 * 1024;

type IdParams = { params: Promise<{ id: string }> };

/** The task, if this organization owns it. */
function ownedTask(db: any, organizationId: string, taskId: string): { id: string } | undefined {
  return db.prepare('SELECT id FROM tasks WHERE id = ? AND organization_id = ?')
    .get(taskId, organizationId);
}

export const listTaskAttachments = withPermission('manage_tasks', async (
  _request, { params }: IdParams, actor: Actor,
) => {
  try {
    const { id } = await params;
    const db = getDb();
    if (!ownedTask(db, actor.organizationId, id)) return notFound();

    const attachments = db.prepare(`
      SELECT a.*, u.full_name as creator_name
      FROM task_attachments a
      LEFT JOIN app_users u ON a.created_by = u.id
      WHERE a.task_id = ? AND a.organization_id = ?
      ORDER BY a.created_at DESC
    `).all(id, actor.organizationId);
    return NextResponse.json(attachments);
  } catch (error: any) {
    console.error('GET task attachments error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to list attachments' }, { status: 500 });
  }
});

export const uploadTaskAttachment = withPermission('manage_tasks', async (
  request: NextRequest, { params }: IdParams, actor: Actor,
) => {
  try {
    const { id: taskId } = await params;
    const db = getDb();
    if (!ownedTask(db, actor.organizationId, taskId)) return notFound();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({
        error: `Непідтримуваний тип файлу "${file.type}". Дозволено: jpg, png, webp, gif, svg, heic, pdf`,
      }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Файл завеликий. Максимум 10MB' }, { status: 400 });
    }

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    const ext = path.extname(file.name) || '.jpg';
    const baseName = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    const filename = `${baseName}_${Date.now()}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(await file.arrayBuffer()));

    const result = db.prepare(`
      INSERT INTO task_attachments (task_id, organization_id, filename, url, file_size, content_type, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, actor.organizationId, file.name, `/api/uploads/tasks/${filename}`,
           file.size, file.type, actor.user.id);

    const attachment = db.prepare('SELECT * FROM task_attachments WHERE rowid = ?')
      .get(result.lastInsertRowid);
    return NextResponse.json(attachment, { status: 201 });
  } catch (error: any) {
    console.error('POST task attachment error:', error?.message || error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
});

export const deleteTaskAttachment = withPermission('manage_tasks', async (
  request: NextRequest, { params }: IdParams, actor: Actor,
) => {
  try {
    const { id: taskId } = await params;
    const { attachment_id } = await request.json();
    if (!attachment_id) {
      return NextResponse.json({ error: 'attachment_id required' }, { status: 400 });
    }

    const db = getDb();
    const attachment = db.prepare(
      'SELECT * FROM task_attachments WHERE id = ? AND task_id = ? AND organization_id = ?',
    ).get(attachment_id, taskId, actor.organizationId) as any;
    if (!attachment) return notFound();

    // The row goes whether or not the file is still on disk; a missing file
    // must not leave an attachment nobody can remove.
    const filename = String(attachment.url || '').split('/').pop();
    if (filename) {
      const filePath = path.join(UPLOAD_DIR, filename);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }
      catch (e: any) { console.error('task attachment file not removed:', e?.message); }
    }
    db.prepare('DELETE FROM task_attachments WHERE id = ? AND organization_id = ?')
      .run(attachment_id, actor.organizationId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE task attachment error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to delete attachment' }, { status: 500 });
  }
});
