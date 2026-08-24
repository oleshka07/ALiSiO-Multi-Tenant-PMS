/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { cloudOcrAllowed } from '@core/privacy/ocr-consent';
import { ocrDocument } from '@/modules/guests/domain/ai/ocr-document';
import { checkRateLimit } from '@core/security/rate-limit';

/**
 * Read a guest's identity document, from the guest's own page.
 *
 * Two things were wrong here and they compounded.
 *
 * The token was never checked against anything: it went in as a rate-limit
 * key and nowhere else. So the limit was per made-up string — send a new one
 * each time and there was no limit at all — on an endpoint that calls a paid
 * vision API. And with no reservation resolved there was no organization, so
 * the consent question below was asked of whichever hotel happened to be
 * oldest on the server, and answered for a guest of a different one.
 *
 * Now the token is resolved first. An unknown one is a 404 and costs nothing;
 * a real one names the hotel, and that hotel's own answer decides whether the
 * photograph may leave the server.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  // Before the rate limiter, so a forged token cannot spend anyone's budget.
  const sql = getSql();
  const reservation: any = await sql.row<any>(
    'SELECT organization_id FROM reservations WHERE guest_page_token = ?', [token]);
  if (!reservation?.organization_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const rl = await checkRateLimit(token, 'registration', 5, 10); // 5 per 10 minutes
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many OCR attempts. Please try again later.' }, { status: 429 });
  }

  try {
    const bodyStr = await request.text();
    // Prevent gigabyte payload attacks (limit to 10MB)
    if (bodyStr.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large (max 10MB)' }, { status: 413 });
    }

    const { image } = JSON.parse(bodyStr);
    if (!image) return NextResponse.json({ error: 'Missing image' }, { status: 400 });

    // Pass the full data URL (data:image/...;base64,...) to OCR
    const dataUrl = image.includes('base64,') ? image : `data:image/jpeg;base64,${image}`;
    const result = await ocrDocument(dataUrl, {
      allowCloudFallback: await cloudOcrAllowed(reservation.organization_id),
    });

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[OCR] Error:', err?.message);
    return NextResponse.json(
      { success: false, error: 'OCR processing failed' },
      { status: 500 }
    );
  }
}
