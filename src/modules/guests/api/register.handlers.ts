/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as registrationRepo from '../data/registration.repo';
// TODO: replace with @channels eventBus event when channels module is migrated
import { checkRateLimit } from '@core/security/rate-limit';
import { maskDobForSheets, maskDocNumberForSheets } from '@core/security/pii-mask';

/** POST to Google Apps Script */
async function syncToGoogleSheets(guests: any[], reservation: any): Promise<void> {
  const url = process.env.GOOGLE_GUESTS_SCRIPT_URL;
  if (!url) return; // not configured — skip silently

  for (const guest of guests) {
    const nights = reservation.check_in && reservation.check_out
      ? Math.max(0, (new Date(reservation.check_out + 'T00:00:00Z').getTime() - new Date(reservation.check_in + 'T00:00:00Z').getTime()) / 86400000)
      : 0;

    const payload = {
      action: 'guest',
      full_name: `${guest.lastName || ''} ${guest.firstName || ''}`.trim(),
      surname: guest.lastName || '',
      first_name: guest.firstName || '',
      birth_date: maskDobForSheets(guest.dateOfBirth),
      doc_type: guest.documentType || '',
      doc_number: maskDocNumberForSheets(guest.documentNumber),
      country_code: '',
      nationality: guest.nationality || '',
      address: '',  // PII minimization — full address stays in PMS only
      visa_number: '',
      check_in: reservation.check_in || '',
      check_out: reservation.check_out || '',
      nights,
      is_foreigner: 'Tak',
      tax_amount: 0,
      exempt_reason: '',
      purpose: '',
      note: '[Web registration via guest portal]',
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      const text = await resp.text();
      if (resp.ok && !text.toLowerCase().includes('error')) {
        console.log('[GuestReg Sheets] Synced:', payload.full_name);
      } else {
        console.error('[GuestReg Sheets] Error:', resp.status, text.slice(0, 200));
      }
    } catch (e: any) {
      console.error('[GuestReg Sheets] Failed:', e.message);
    }
  }
}

export async function registerGuests(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const body = await request.json();

    const reservation = await registrationRepo.getReservationForRegistration(token);
    if (!reservation) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const rl = await checkRateLimit(token, 'registration', 3, 5);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please wait a few minutes.' }, { status: 429 });
    }

    const { guests } = body;
    if (!guests || !Array.isArray(guests) || guests.length === 0) {
      return NextResponse.json({ error: 'At least one guest is required' }, { status: 400 });
    }

    const VALID_DOC_TYPES = ['id_card', 'passport', 'driving_license', 'other'] as const;
    const guestSchema = z.object({
      firstName: z.string().min(1).max(100),
      lastName: z.string().min(1).max(100),
      // Optional fields
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
      documentType: z.enum(VALID_DOC_TYPES).nullable().optional().default('other'),
      documentNumber: z.string().max(50).nullable().optional(),
      nationality: z.string().max(50).nullable().optional(),
      address: z.string().max(255).nullable().optional(),
      purposeOfStay: z.string().max(100).nullable().optional(),
      visaNumber: z.string().max(50).nullable().optional(),
    });

    const parsedGuests = [];
    for (const g of guests) {
      // Normalise documentType: empty string → 'other'
      const normalized = {
        ...g,
        documentType: VALID_DOC_TYPES.includes(g.documentType) ? g.documentType : 'other',
        dateOfBirth: g.dateOfBirth || null,
        documentNumber: g.documentNumber || null,
        nationality: g.nationality || null,
      };
      const result = guestSchema.safeParse(normalized);
      if (!result.success) {
        return NextResponse.json({ error: `Validation failed: ${result.error.issues[0].message}` }, { status: 400 });
      }
      parsedGuests.push(result.data);
    }

    const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
    const registeredGuests = await registrationRepo.saveRegistrations(reservation.id, reservation.organization_id, parsedGuests, clientIp);

    // ── Auto-sync to Google Sheets (non-blocking) ─────────────────────────
    syncToGoogleSheets(parsedGuests, reservation).catch(() => {});

    return NextResponse.json({ success: true, registeredGuests });
  } catch (error: any) {
    console.error('POST /api/guest/[token]/register error:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to register guests' }, { status: 500 });
  }
}
