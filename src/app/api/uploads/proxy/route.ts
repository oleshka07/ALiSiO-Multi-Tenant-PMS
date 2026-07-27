import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    let file: File | null = null;
    try {
      const formData = await request.formData();
      file = formData.get('file') as File;
    } catch (e: any) {
      console.error('[UploadProxy] FormData error:', e);
      return NextResponse.json({ error: `Помилка читання файлу: ${e.message}` }, { status: 400 });
    }

    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

    // --- Try Catbox.moe first ---
    try {
      const catboxData = new FormData();
      catboxData.append('reqtype', 'fileupload');
      catboxData.append('fileToUpload', file, file.name);

      const res = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: catboxData,
      });

      if (res.ok) {
        const url = await res.text();
        if (url.startsWith('http')) return new NextResponse(url.trim());
      }
    } catch (e) {
      console.warn('[UploadProxy] Catbox failed, trying Pixeldrain...', e);
    }

    // --- Fallback: Pixeldrain ---
    const pdData = new FormData();
    pdData.append('file', file);
    const pdRes = await fetch('https://pixeldrain.com/api/file', {
      method: 'POST',
      body: pdData,
    });

    if (pdRes.ok) {
      const data = await pdRes.json();
      if (data.id) return new NextResponse(`https://pixeldrain.com/api/file/${data.id}`);
    }

    return NextResponse.json({ error: 'Всі сервіси завантаження недоступні. Спробуйте пізніше або інший файл.' }, { status: 500 });
  } catch (error: any) {
    console.error('Upload proxy error:', error);
    return NextResponse.json({ error: error.message || 'Unknown upload error' }, { status: 500 });
  }
}
