import { NextResponse } from 'next/server';
import { anonymizeOldRegistrations } from '@/modules/guests/data/registration.repo';

export async function GET(request: Request) {
  // Fails closed. This used to run unauthenticated whenever CRON_SECRET was
  // unset, and it permanently anonymises guest records — the one operation in
  // the system that cannot be undone.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 6 months is standard, but you can pass ?months=X in URL
    const { searchParams } = new URL(request.url);
    const monthsParam = searchParams.get('months');
    const months = monthsParam ? parseInt(monthsParam, 10) : 6;

    const anonymizedCount = await anonymizeOldRegistrations(months);

    return NextResponse.json({
      success: true,
      message: `GDPR CRON: Anonymized ${anonymizedCount} guest records older than ${months} months.`,
      anonymizedCount
    });
  } catch (err: any) {
    console.error('[GDPR Cron Error]:', err);
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}
