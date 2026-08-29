/**
 * Channex, якого можна тримати в руках.
 *
 * Справжній сервер не вміє на вимогу відповісти `429`, а потім `200` з
 * непорожніми `meta.warnings` — а саме на цих двох відповідях клієнт і
 * ламається найтихіше. Тому перевірка ганяє СПРАВЖНІЙ HTTP проти цього
 * мока: підмінений `fetch` перевіряв би, що ми правильно склали виклик, а
 * не що ми правильно прочитали відповідь.
 *
 * Форми відповідей узяті дослівно з документації ARI — включно з тим, що
 * помилка валідації приходить із кодом `200`.
 *
 * Це стенд, а не частина інтеграції: жоден маршрут його не імпортує, і
 * логіка інтеграції в ньому не живе (сертифікація Channex окремо відмовляє
 * тим, у кого «integration logic lives in test files»).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedCall {
  path: string;
  apiKey: string | undefined;
  body: { values?: unknown[] } & Record<string, unknown>;
}

/** Що мок відповість на наступний виклик. */
export type Reply =
  | { kind: 'ok'; taskIds?: string[] }
  | { kind: 'warnings'; warnings: unknown[]; taskIds?: string[] }
  | { kind: 'rateLimited' }
  | { kind: 'unauthorized' }
  | { kind: 'serverError' }
  | { kind: 'garbage' };

export interface MockChannex {
  url: string;
  calls: RecordedCall[];
  /** Черга відповідей. Порожня — відповідає успіхом. */
  queue: Reply[];
  close(): Promise<void>;
}

function render(reply: Reply): { status: number; body: unknown } {
  switch (reply.kind) {
    case 'ok':
      return {
        status: 200,
        body: {
          data: (reply.taskIds ?? ['task-1']).map((id) => ({ id, type: 'task' })),
          meta: { message: 'Success', warnings: [] },
        },
      };
    case 'warnings':
      // Дослівно форма «Validation Error Response» з документації ARI:
      // код 200, порожній data, претензії в meta.warnings.
      return {
        status: 200,
        body: {
          data: (reply.taskIds ?? []).map((id) => ({ id, type: 'task' })),
          meta: { message: 'Success', warnings: reply.warnings },
        },
      };
    case 'rateLimited':
      return { status: 429, body: { errors: { code: 'http_too_many_requests', title: 'Too Many Requests' } } };
    case 'unauthorized':
      return { status: 401, body: { errors: { code: 'unauthorized', title: 'Unauthorized' } } };
    case 'serverError':
      return { status: 500, body: { errors: { code: 'internal_error', title: 'Internal Server Error' } } };
    case 'garbage':
      return { status: 502, body: null };
  }
}

export async function startMockChannex(): Promise<MockChannex> {
  const calls: RecordedCall[] = [];
  const queue: Reply[] = [];

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
      calls.push({
        path: req.url ?? '',
        apiKey: req.headers['user-api-key'] as string | undefined,
        body,
      });

      const reply = queue.shift() ?? { kind: 'ok' as const };
      const { status, body: payload } = render(reply);

      if (reply.kind === 'garbage') {
        // Не JSON: сторінка проксі перед API. Клієнт мусить пережити.
        res.writeHead(status, { 'Content-Type': 'text/html' });
        res.end('<html><body>502 Bad Gateway</body></html>');
        return;
      }

      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    queue,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
