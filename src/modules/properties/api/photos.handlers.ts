/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@core/db';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'uploads', 'photos');
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

export async function uploadPhoto(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const unitTypeId = formData.get('unit_type_id') as string;
    const propertyId = formData.get('property_id') as string;
    const caption = formData.get('caption') as string || '';
    const sortOrder = parseInt(formData.get('sort_order') as string || '0');

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!unitTypeId && !propertyId) {
      return NextResponse.json({ error: 'unit_type_id or property_id is required' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP, AVIF' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large. Max 5MB.' }, { status: 400 });
    }

    const db = getDb();
    const entityId = unitTypeId || propertyId;
    const entityType = unitTypeId ? 'unit_type' : 'property';

    const table = entityType === 'unit_type' ? 'unit_type_photos' : 'property_photos';
    const fkCol = entityType === 'unit_type' ? 'unit_type_id' : 'property_id';
    const count = (db.prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE ${fkCol} = ?`).get(entityId) as any)?.cnt || 0;
    if (count >= 10) {
      return NextResponse.json({ error: 'Max 10 photos per entity' }, { status: 400 });
    }

    const dir = path.join(DATA_DIR, entityType, entityId);
    fs.mkdirSync(dir, { recursive: true });

    const ext = file.name.split('.').pop() || 'jpg';
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(dir, fileName);

    const arrayBuffer = await file.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    const url = `/api/photos/${entityType}/${entityId}/${fileName}`;
    db.prepare(`INSERT INTO ${table} (${fkCol}, url, caption, sort_order) VALUES (?, ?, ?, ?)`)
      .run(entityId, url, caption, sortOrder);

    // Sync with unit_types table if it's a unit_type photo
    if (entityType === 'unit_type') {
      const allPhotos = db.prepare(`SELECT url FROM unit_type_photos WHERE unit_type_id = ? ORDER BY sort_order ASC, created_at ASC`).all(entityId) as any[];
      const photosCsv = allPhotos.map(p => p.url).join(',');
      db.prepare(`UPDATE unit_types SET photos = ? WHERE id = ?`).run(photosCsv, entityId);
    }

    return NextResponse.json({ success: true, url });
  } catch (error: any) {
    console.error('Photo upload error:', error?.message || error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

export async function deletePhoto(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const type = searchParams.get('type') || 'unit_type';

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const db = getDb();
    const table = type === 'property' ? 'property_photos' : 'unit_type_photos';

    const photo = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as any;
    if (!photo) return NextResponse.json({ error: 'Photo not found' }, { status: 404 });

    if (photo.url?.startsWith('/api/photos/')) {
      const parts = photo.url.replace('/api/photos/', '').split('/');
      const filePath = path.join(DATA_DIR, ...parts);
      try { fs.unlinkSync(filePath); } catch { /* file may not exist */ }
    }

    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Photo delete error:', error?.message || error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
