import { getDb } from '@core/db';

/**
 * Is this organization willing to have identity documents read in the cloud?
 *
 * Local MRZ extraction always runs and never leaves the server. This flag
 * governs only the fallback that uploads the photograph itself to OpenAI, which
 * is a transfer of identity-document data to a processor outside the EU: the
 * hotel is the controller, we are the processor, and OpenAI would be a
 * sub-processor the hotel has to disclose to its guests.
 *
 * Defaults to off. A missing column or an unreadable row also reads as off —
 * the failure mode has to be "the guest types it in", never "the document was
 * sent abroad because a query threw".
 *
 * ponytail: resolves the single organization when no id is given. Takes the id
 * from the request once tenant context lands.
 */
export function cloudOcrAllowed(organizationId?: string): boolean {
  try {
    const db = getDb();
    const row = (organizationId
      ? db.prepare('SELECT ocr_cloud_fallback AS v FROM organizations WHERE id = ?').get(organizationId)
      : db.prepare('SELECT ocr_cloud_fallback AS v FROM organizations ORDER BY created_at LIMIT 1').get()) as
      | { v: number | null }
      | undefined;
    return !!row?.v;
  } catch {
    return false;
  }
}
