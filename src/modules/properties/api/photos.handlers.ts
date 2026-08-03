/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
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

    const sql = getSql();
    const entityId = unitTypeId || propertyId;
    const entityType = unitTypeId ? 'unit_type' : 'property';

    const table = entityType === 'unit_type' ? 'unit_type_photos' : 'property_photos';
    const fkCol = entityType === 'unit_type' ? 'unit_type_id' : 'property_id';
    const count = (await sql.row<any>(`SELECT COUNT(*) as cnt FROM ${table} WHERE ${fkCol} = ?`, [entityId]) as any)?.cnt || 0;
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
    await sql.run(`INSERT INTO ${table} (${fkCol}, url, caption, sort_order) VALUES (?, ?, ?, ?)`, [entityId, url, caption, sortOrder]);

    // Sync with unit_types table if it's a unit_type photo
    if (entityType === 'unit_type') {
      const allPhotos = await sql.rows<any>(`SELECT url FROM unit_type_photos WHERE unit_type_id = ? ORDER BY sort_order ASC, created_at ASC`, [entityId]) as any[];
      const photosCsv = allPhotos.map(p => p.url).join(',');
      await sql.run(`UPDATE unit_types SET photos = ? WHERE id = ?`, [photosCsv, entityId]);
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

    const sql = getSql();
    const table = type === 'property' ? 'property_photos' : 'unit_type_photos';

    const photo = await sql.row<any>(`SELECT * FROM ${table} WHERE id = ?`, [id]) as any;
    if (!photo) return NextResponse.json({ error: 'Photo not found' }, { status: 404 });

    if (photo.url?.startsWith('/api/photos/')) {
      const parts = photo.url.replace('/api/photos/', '').split('/');
      const filePath = path.join(DATA_DIR, ...parts);
      try { fs.unlinkSync(filePath); } catch { /* file may not exist */ }
    }

    await sql.run(`DELETE FROM ${table} WHERE id = ?`, [id]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Photo delete error:', error?.message || error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
