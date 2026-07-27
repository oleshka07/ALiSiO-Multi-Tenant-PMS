/* eslint-disable @typescript-eslint/no-explicit-any */
import OpenAI from 'openai';
import { getDb } from '@/lib/db';
import { SYSTEM_PROMPT } from './schema-context';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// Only allow safe SELECT queries
function validateSql(sql: string): void {
  const normalized = sql.trim().toUpperCase();
  const dangerous = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'REPLACE', 'ATTACH', 'DETACH', 'PRAGMA'];
  for (const keyword of dangerous) {
    if (new RegExp(`\\b${keyword}\\b`).test(normalized)) {
      throw new Error(`Заборонена SQL-операція: ${keyword}. Дозволено лише SELECT.`);
    }
  }
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    throw new Error('SQL запит повинен починатися з SELECT або WITH.');
  }
}

function executeSql(sql: string): { columns: string[]; rows: Record<string, any>[]; rowCount: number } {
  validateSql(sql);
  const db = getDb();
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all() as Record<string, any>[];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows: rows.slice(0, 200), rowCount: rows.length };
  } catch (err: any) {
    throw new Error(`SQL помилка: ${err.message}`);
  }
}

const executeSqlTool: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'execute_sql',
    description: 'Execute a SELECT SQL query against the ALiSiO PMS SQLite database and return results as JSON. Only SELECT queries are allowed.',
    parameters: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'The SQL SELECT query to execute',
        },
        description: {
          type: 'string',
          description: 'Short description of what this query does (for logging)',
        },
      },
      required: ['sql'],
    },
  },
};

/**
 * Streams an AI answer to a user question about PMS data.
 * Uses OpenAI function calling: model calls execute_sql → DB → model formats answer.
 * Yields text chunks as they stream.
 */
export async function* streamAiAnswer(
  question: string,
  history: ChatMessage[] = [],
): AsyncGenerator<string> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(m => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
    { role: 'user', content: question },
  ];

  let continueLoop = true;

  while (continueLoop) {
    const stream = await client.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools: [executeSqlTool],
      tool_choice: 'auto',
      stream: true,
    });

    // Accumulate streamed response
    let accumulatedText = '';
    const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      finishReason = chunk.choices[0]?.finish_reason ?? finishReason;

      // Text delta — stream to client
      if (delta.content) {
        accumulatedText += delta.content;
        yield delta.content;
      }

      // Tool call delta — accumulate
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallsMap[idx]) {
            toolCallsMap[idx] = { id: '', name: '', arguments: '' };
          }
          if (tc.id) toolCallsMap[idx].id = tc.id;
          if (tc.function?.name) toolCallsMap[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
        }
      }
    }

    const toolCalls = Object.values(toolCallsMap);

    if (finishReason === 'tool_calls' && toolCalls.length > 0) {
      // Append assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: accumulatedText || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Execute each tool call
      for (const tc of toolCalls) {
        if (tc.name !== 'execute_sql') continue;

        let resultContent: string;
        try {
          const input = JSON.parse(tc.arguments) as { sql: string; description?: string };
          const result = executeSql(input.sql);
          resultContent = JSON.stringify({
            success: true,
            rowCount: result.rowCount,
            columns: result.columns,
            rows: result.rows,
          });
        } catch (err: any) {
          resultContent = JSON.stringify({ success: false, error: err.message });
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultContent,
        });
      }
      // Continue loop — model will now interpret results
    } else {
      continueLoop = false;
    }
  }
}
