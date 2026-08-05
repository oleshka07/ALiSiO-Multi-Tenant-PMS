/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { cloudOcrAllowed } from '@core/privacy/ocr-consent';
import { ocrDocument } from '@/modules/guests/domain/ai/ocr-document';
import { withPermission } from '@core/auth/session';

/**
 * POST /api/bookings/ocr
 * Body: { image: "data:image/...;base64,..." }
 * Runs GPT-4o vision OCR on the document image and returns extracted fields.
 *
 * It reads a guest's identity document, so it needs a session: unguarded, it
 * was an OCR service anyone with a login could point at any image, on the
 * hotel's OpenAI bill, and the cloud-consent flag it honours belongs to an
 * organization it had no way to identify.
 */
export const POST = await withPermission('manage_guests', async (req: Request) => {
  try {
    const { image } = await req.json();
    if (!image) {
      return NextResponse.json({ error: 'Missing image' }, { status: 400 });
    }

    const dataUrl = image.includes('base64,') ? image : `data:image/jpeg;base64,${image}`;
    const result = await ocrDocument(dataUrl, { allowCloudFallback: await cloudOcrAllowed() });

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[OCR Admin] Error:', err?.message);
    return NextResponse.json(
      { success: false, error: err?.message || 'OCR processing failed' },
      { status: 500 }
    );
  }
})
