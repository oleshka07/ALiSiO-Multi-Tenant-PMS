/**
 * GET|POST /api/cron/sync-cnb-rates
 *
 * Тягне денний фіксинг ČNB і розкладає <CUR>→CZK у finance_exchange_rates.
 * Раз на добу з крона; вручну — з ?date=YYYY-MM-DD (добір за минулий день)
 * і ?currencies=EUR,USD.
 *
 * Право: заголовок x-cron-secret або Bearer CRON_SECRET, як у решти кронів.
 *
 * ── Чому тут цикл по готелях ────────────────────────────────────────────
 *
 * Було: один виклик `syncCnbRates()` без жодного орендаря. Всередині він
 * питав `requireOrganizationId()`, а той кидає виняток, щойно готелів
 * більше одного, — тобто на будь-якому реальному сервері крон повертав 502
 * і курси не оновлювались НІ ДЛЯ КОГО. З одним готелем це виглядало
 * робочим, і саме тому протрималось.
 *
 * Крон за визначенням не має орендаря: він працює за всіх. Отже, орендар
 * ставиться в циклі — той самий шов, що в `cron/gdpr-retention`.
 *
 * ── Чому лише CZK-готелі ────────────────────────────────────────────────
 *
 * ČNB — чеський фіксинг: «скільки крон коштує євро». Готелю, який виставляє
 * рахунки в EUR, цей рядок не потрібен і нічого не означає. Курси для інших
 * юрисдикцій (НБУ, ЄЦБ) — окремі джерела, яких ще немає; поки їх немає,
 * чесніше не писати нічого, ніж писати чеський курс усім.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { syncCnbRates, fetchCnbFixing } from '@finance';
import { cronAuthFailure } from '@core/security/cron-auth';

async function handle(request: NextRequest): Promise<NextResponse> {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || undefined;
    const currencies = searchParams.get('currencies')?.split(',').map(c => c.trim()).filter(Boolean);

    // Один запит до банку на весь прохід, а не по одному на готель.
    const fixing = await fetchCnbFixing(date);

    const sql = getSql();
    const hotels = await sql.rows<{ id: string }>(
      "SELECT id FROM organizations WHERE default_currency = 'CZK'",
    );

    let upserted = 0;
    const failed: string[] = [];
    for (const hotel of hotels) {
      try {
        const result = await syncCnbRates({ currencies, organizationId: hotel.id, fixing });
        upserted += result.upserted.length;
      } catch (e: unknown) {
        // Один готель не має валити прохід: решта курсів потрібні сьогодні.
        failed.push(hotel.id);
        console.error('[ČNB Rates]', hotel.id, e instanceof Error ? e.message : String(e));
      }
    }

    console.log('[ČNB Rates] Synced', fixing.date, '→', `${upserted} rate(s) across ${hotels.length} hotel(s)`);
    return NextResponse.json({ ok: true, date: fixing.date, hotels: hotels.length, upserted, failed });
  } catch (e: unknown) {
    // 502 віддає ВЕНДОР, тобто текст, якого ми не писали, — рівно те, від чого
    // інваріант 6. Деталь у лог із міткою місця, назовні — речення.
    // `ok: false` лишається: його читає `deploy/run-cron.sh`, і саме за ним
    // крон вважається невдалим (AGENTS §5).
    console.error('[ČNB Rates]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: 'ČNB rates are unavailable' }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
