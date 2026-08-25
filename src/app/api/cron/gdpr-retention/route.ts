import { getSql } from '@core/db/async';
import { NextRequest, NextResponse } from 'next/server';
import { cronAuthFailure } from '@core/security/cron-auth';
import { serverError } from '@core/http/errors';

export async function GET(request: NextRequest) {
  // Anonymises six-year-old registrations. It used to refuse only when
  // NODE_ENV was production, against a secret that defaulted to a word printed
  // in this file — so in every other environment it ran for anyone who asked.
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  try {
    const sql = getSql();

    // 6 years retention for Evidenční kniha
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 6);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    await sql.tx(async (t) => {
      // 1. Anonymize reservation_guests where reservation check_out is older than 6 years
      await t.run(`
        UPDATE reservation_guests
        SET first_name = 'Anonymized',
            last_name = 'Anonymized',
            date_of_birth = NULL,
            document_type = NULL,
            document_number = NULL,
            nationality = NULL,
            address = NULL,
            visa_number = NULL,
            purpose_of_stay = NULL
        WHERE reservation_id IN (
          SELECT id FROM reservations WHERE check_out < ?
        ) AND first_name != 'Anonymized'
      `, [cutoffStr]);

      // 2. Anonymize guests table if they have NO reservations newer than 6 years
      // and their last update was > 6 years ago
      await t.run(`
        UPDATE guests
        SET first_name = 'Anonymized',
            last_name = 'Anonymized',
            email = NULL,
            phone = NULL,
            date_of_birth = NULL,
            document_type = NULL,
            document_number = NULL,
            country = NULL,
            address = NULL
        WHERE id NOT IN (
          SELECT g.id
          FROM guests g
          JOIN reservations r ON r.guest_id = g.id
          WHERE r.check_out >= ?
        )
        AND id NOT IN (
          SELECT g.id
          FROM guests g
          JOIN reservation_guests rg ON rg.guest_id = g.id
          JOIN reservations r ON rg.reservation_id = r.id
          WHERE r.check_out >= ?
        )
        AND first_name != 'Anonymized'
      `, [cutoffStr, cutoffStr]);

      // 3. Delete from guest_registrations if reservation is older than 6 years
      await t.run(`
        DELETE FROM guest_registrations
        WHERE reservation_id IN (
          SELECT id FROM reservations WHERE check_out < ?
        )
      `, [cutoffStr]);
    });

    return NextResponse.json({ success: true, message: 'Data retention policy applied successfully' });
  } catch (error: any) {
    console.error('GDPR Retention Cron Error:', error);
    return serverError('app/api/cron/gdpr-retention GET', error);
  }
}
