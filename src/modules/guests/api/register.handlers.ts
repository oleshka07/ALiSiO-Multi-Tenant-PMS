/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as registrationRepo from '../data/registration.repo';
// TODO: replace with @channels eventBus event when channels module is migrated
import { checkRateLimit } from '@core/security/rate-limit';
import { serverError } from '@core/http/errors';

/*
 * Тут стояв `syncToGoogleSheets`: після кожної реєстрації гостя дані летіли
 * POST-ом на Google Apps Script за адресою з `GOOGLE_GUESTS_SCRIPT_URL`.
 *
 * Видалено 2026-08-27 разом із `core/security/pii-mask.ts`, який існував лише
 * заради нього. Причини, у порядку ваги:
 *
 *   1. Одна змінна оточення на весь сервер, а сервер мультитенантний. Кожен
 *      готель, який реєструє гостя, писав би в ОДНУ таблицю — чужу. Це не
 *      налаштування інтеграції, це відсутність тенантності.
 *   2. Персональні дані гостя (імʼя, документ, дата народження, дати заїзду)
 *      йшли за межу системи без згоди, без запису в аудит і без способу це
 *      вимкнути з інтерфейсу. Маскування прикривало два поля з восьми.
 *   3. Ні екрана, ні перемикача, ні ключа в `organization_features`. Про те,
 *      що синк узагалі є, можна було дізнатись лише з цього файлу.
 *
 * Якщо експорт реєстрацій знадобиться — це окремий модуль із власним ключем
 * інтеграції на організацію (`core/integration-credentials.ts`), а не змінна
 * оточення.
 */

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

    return NextResponse.json({ success: true, registeredGuests });
  } catch (error: any) {
    console.error('POST /api/guest/[token]/register error:', error?.message || error);
    return serverError('modules/guests/api/register registerGuests', error, 'Failed to register guests');
  }
}
