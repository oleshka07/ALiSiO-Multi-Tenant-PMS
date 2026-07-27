import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { saveTrainingData } from '@/lib/ai/crm-suggest'; // TODO: move to @core/ai
import { getSessionUser, getSessionIdFromCookies } from '@/lib/auth';

export async function saveTraining(request: NextRequest) {
  const sessionId = getSessionIdFromCookies(request.headers.get('cookie'));
  const session = getSessionUser(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { conversationId, guestMessage, guestLanguage, leadStage,
            guestContextJson, aiDraft, finalResponse, wasApproved, wasEdited,
            editReason, rating } = body;

    if (!conversationId || !aiDraft || !guestMessage) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    saveTrainingData({
      conversationId, guestMessage, guestLanguage, leadStage,
      guestContextJson, aiDraft, finalResponse,
      wasApproved: !!wasApproved, wasEdited: !!wasEdited, editReason, rating,
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CRM AI Training POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function listTraining(request: NextRequest) {
  const sessionId = getSessionIdFromCookies(request.headers.get('cookie'));
  const session = getSessionUser(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const stage = searchParams.get('stage');
    const approved = searchParams.get('approved');

    let query = 'SELECT * FROM crm_ai_training WHERE 1=1';
    const params: (string | number)[] = [];

    if (stage) { query += ' AND lead_stage = ?'; params.push(stage); }
    if (approved !== null && approved !== undefined && approved !== '') {
      query += ' AND was_approved = ?';
      params.push(approved === 'true' ? 1 : 0);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(query).all(...params);
    return NextResponse.json({ training: rows, count: rows.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
