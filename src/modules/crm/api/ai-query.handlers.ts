import { NextRequest } from 'next/server';
// TODO: move to @core/ai when AI module is extracted
import { streamAiAnswer, ChatMessage } from '@/lib/ai/query-engine';
import { getSessionUser, getSessionIdFromCookies } from '@core/auth';

export async function queryAi(request: NextRequest) {
  const sessionId = getSessionIdFromCookies(request.headers.get('cookie'));
  const session = getSessionUser(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY не налаштовано. Додайте його в .env файл.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let question: string;
  let history: ChatMessage[];

  try {
    const body = await request.json();
    question = body.question?.trim();
    history = body.history ?? [];
    if (!question) throw new Error('Empty question');
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
        for await (const chunk of streamAiAnswer(question, history)) {
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
