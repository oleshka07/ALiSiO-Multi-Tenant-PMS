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
  method: string;
  path: string;
  apiKey: string | undefined;
  body: { values?: unknown[] } & Record<string, unknown>;
}

/** Що мок відповість на наступний виклик. */
export type Reply =
  | { kind: 'ok'; taskIds?: string[] }
  | { kind: 'warnings'; warnings: unknown[]; taskIds?: string[] }
  // Стрічка ревізій. `revisions` — ПЛОСКІ ревізії; мок сам загортає кожну в
  // конверт `{ type, id, attributes }`, як це робить справжній API. Конверт
  // тут не декорація: клієнт, який його не розгорне, віддасть маперу об'єкт
  // без жодного знайомого поля, і стрічка мовчки стане порожньою.
  | { kind: 'feed'; revisions: Record<string, unknown>[]; total?: number; page?: number; limit?: number }
  | { kind: 'ackOk' }
  // Створена сутність каталогу: конверт `{ data: { id, attributes } }`.
  // `options` мок будує сам за надісланими — і робить це так, як живий API:
  // основна опція отримує id САМОГО ТАРИФУ, решта власні, а порядок у
  // відповіді не той, у якому просили (INVENTORY §3.1). Код, який читає
  // `options[0]` як «перша заселеність», мусить тут спіткнутись.
  // `omitOccupancies` — заселеності, яких у ВІДПОВІДІ не буде, хоч їх і
  // просили. Так виглядає тариф, створений наполовину: помилки немає, опції
  // просто менше, і ціну тієї заселеності потім нема куди покласти.
  | { kind: 'created'; id: string; omitOccupancies?: number[] }
  // Разовий токен для вбудованого вікна: `{ data: { token } }` дослівно з channel-iframe.md.
  | { kind: 'token'; token: string }
  // Список у конверті JSON:API — обʼєкти, канали: `{ data: [{ id, type, attributes }] }`.
  | { kind: 'list'; data: unknown[] }
  | { kind: 'rateLimited' }
  | { kind: 'unauthorized' }
  | { kind: 'notFound' }
  | { kind: 'serverError' }
  | { kind: 'garbage' };

export interface MockChannex {
  url: string;
  calls: RecordedCall[];
  /** Черга відповідей. Порожня — відповідає успіхом. */
  queue: Reply[];
  close(): Promise<void>;
}

function render(reply: Reply, request?: Record<string, unknown>): { status: number; body: unknown } {
  switch (reply.kind) {
    case 'created': {
      // Опції відбиваються назад так, як це робить живий API: основна несе id
      // самого тарифу, решта — власні, і порядок перевернутий.
      const plan = request?.rate_plan as { options?: { occupancy?: number; is_primary?: boolean }[] } | undefined;
      const omit = new Set(reply.omitOccupancies ?? []);
      const asked = (Array.isArray(plan?.options) ? plan.options : [])
        .filter((o) => !omit.has(Number(o.occupancy)));
      let n = 0;
      const options = asked.map((o) => ({
        occupancy: o.occupancy,
        is_primary: !!o.is_primary,
        id: o.is_primary ? reply.id : `${reply.id}-opt-${++n}`,
        derived_option: o.is_primary ? null : { rate: [] },
      }));
      return {
        status: 200,
        body: {
          data: {
            id: reply.id,
            type: 'rate_plan',
            attributes: { id: reply.id, options: options.reverse() },
          },
        },
      };
    }
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
    case 'feed': {
      const revisions = reply.revisions;
      return {
        status: 200,
        body: {
          data: revisions.map((r) => ({
            type: 'booking_revision',
            id: r.id,
            attributes: r,
          })),
          meta: {
            total: reply.total ?? revisions.length,
            page: reply.page ?? 1,
            limit: reply.limit ?? 10,
          },
        },
      };
    }
    case 'token':
      return { status: 200, body: { data: { token: reply.token }, meta: { message: 'You are successfully received one-time token! Use it for exchange to JWT' } } };
    case 'list':
      return { status: 200, body: { data: reply.data, meta: { total: reply.data.length } } };
    case 'ackOk':
      return { status: 200, body: { meta: { message: 'Success' } } };
    case 'rateLimited':
      return { status: 429, body: { errors: { code: 'http_too_many_requests', title: 'Too Many Requests' } } };
    case 'notFound':
      return { status: 404, body: { errors: { code: 'resource_not_found', title: 'Resource Not Found' } } };
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
        method: req.method ?? '',
        path: req.url ?? '',
        apiKey: req.headers['user-api-key'] as string | undefined,
        body,
      });

      const reply = queue.shift() ?? { kind: 'ok' as const };
      const { status, body: payload } = render(reply, body);

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
