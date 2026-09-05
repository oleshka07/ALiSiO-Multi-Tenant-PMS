import { NextResponse } from 'next/server';
import { withActor, type Actor } from '@core/auth/session';
import { setupProgressFor } from '../data/setup-progress.repo';

/**
 * GET /api/properties/[id]/setup-progress — вісім кроків онбордингу обʼєкта
 * (MASTER-PLAN §1.4). Стан виводиться з даних, не зберігається. Чужий
 * обʼєкт — 404 (інваріант 5).
 */
export const getSetupProgress = withActor(async (_request, context: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const { id } = await context.params;
    const progress = await setupProgressFor(actor.organizationId, id);
    if (!progress) return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    return NextResponse.json(progress);
  } catch (error) {
    console.error('GET /api/properties/:id/setup-progress error:', error);
    return NextResponse.json({ error: 'Failed to compute setup progress' }, { status: 500 });
  }
});
