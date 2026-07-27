import { NextRequest } from 'next/server';
import { streamCrmSuggestion } from '@/lib/ai/crm-suggest'; // TODO: move to @core/ai
import { getSessionUser, getSessionIdFromCookies } from '@/lib/auth';

export async function suggestAiReply(request: NextRequest) {
  const sessionId = getSessionIdFromCookies(request.headers.get('cookie'));
  const session = getSessionUser(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY не налаштовано' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let leadId: string;
  let conversationId: string;
  let instruction: string | undefined;

  try {
    const body = await request.json();
    leadId = body.leadId;
    conversationId = body.conversationId;
    instruction = body.instruction;
    if (!leadId || !conversationId) throw new Error('Missing leadId or conversationId');
  } catch {
    return new Response(JSON.stringify({ error: 'Невірний формат запиту' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamCrmSuggestion(leadId, conversationId, instruction)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Невідома помилка';
        controller.enqueue(encoder.encode(`\n\n⚠️ Помилка: ${msg}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  });
}
