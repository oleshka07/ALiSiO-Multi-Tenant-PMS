import { getSql } from '../db/async.ts';

/**
 * Is this organization willing to have identity documents read in the cloud?
 *
 * Local MRZ extraction always runs and never leaves the server. This flag
 * governs only the fallback that uploads the photograph itself to OpenAI, which
 * is a transfer of identity-document data to a processor outside the EU: the
 * hotel is the controller, we are the processor, and OpenAI would be a
 * sub-processor the hotel has to disclose to its guests.
 *
 * The organization is REQUIRED. It used to be optional, and without it this
 * read `ORDER BY created_at LIMIT 1` — the OLDEST organization on the server —
 * and applied that hotel's consent to every other hotel's guests. All three
 * callers passed nothing. So a hotel that switched cloud OCR off still had its
 * guests' passports sent to OpenAI, because the platform's first customer had
 * switched it on; and a hotel that switched it on got nothing, if the first
 * customer had not. Consent that answers for somebody else is not consent.
 *
 * Defaults to off. A missing column or an unreadable row also reads as off —
 * the failure mode has to be "the guest types it in", never "the document was
 * sent abroad because a query threw".
 */
export async function cloudOcrAllowed(organizationId: string): Promise<boolean> {
  if (!organizationId) return false;
  try {
    const sql = getSql();
    const row = await sql.row<any>(
      'SELECT ocr_cloud_fallback AS v FROM organizations WHERE id = ?', [organizationId]) as
      | { v: number | null }
      | undefined;
    return !!row?.v;
  } catch {
    return false;
  }
}
