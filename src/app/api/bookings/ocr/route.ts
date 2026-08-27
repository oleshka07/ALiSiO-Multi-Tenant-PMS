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
export const POST = await withPermission('manage_guests', async (req: Request, _ctx, actor) => {
  try {
    const { image } = await req.json();
    if (!image) {
      return NextResponse.json({ error: 'Missing image' }, { status: 400 });
    }

    const dataUrl = image.includes('base64,') ? image : `data:image/jpeg;base64,${image}`;
    // The consent belongs to the hotel whose receptionist is holding the
    // document, which is the one in the session — not the oldest row in the
    // organizations table, which is what an argument-less call used to read.
    const result = await ocrDocument(dataUrl, {
      allowCloudFallback: await cloudOcrAllowed(actor.organizationId),
      organizationId: actor.organizationId,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    // The vision provider's own error text used to come back here. It can
    // carry the prompt, the model name and occasionally part of the request —
    // and this endpoint is handed a photograph of somebody's passport.
    console.error('[OCR Admin]', err?.message, err?.stack);
    return NextResponse.json(
      { success: false, error: 'Не вдалося розпізнати документ' },
      { status: 500 },
    );
  }
})
