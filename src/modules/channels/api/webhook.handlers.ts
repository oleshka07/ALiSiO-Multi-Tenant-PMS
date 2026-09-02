import crypto from 'node:crypto';
import { after } from 'next/server';
import { runWithPublicToken, runWithOrganization } from '@core/auth/tenant-context';
import { connectionByWebhookToken } from '../data/connections.repo';
import { recordEvent } from '../data/events.repo';
import { waker } from '../data/wake';
import { pullConnectionNow } from './pull-cron.handlers';

/**
 * Двері вебхука менеджера каналів: `POST /api/webhooks/channel-manager/[token]`.
 *
 *   node src/modules/channels/api/webhook.check.ts
 *
 * ── Сигнал, не дані ─────────────────────────────────────────────────────
 *
 * Підпису у вендора немає — лише секрет у заголовку, який ми самі поклали
 * при реєстрації. Тому тіло тут ніколи не є джерелом броні: двері пишуть
 * сирий рядок у `cm_events`, відповідають одразу і ПІСЛЯ відповіді будять
 * той самий прохід стрічки, що й крон. Правда — стрічка ревізій з `ack` і
 * дедуплікацією; підроблений вебхук з правильним секретом коштує одного
 * зайвого опитування, без секрету — нічого. Крон при цьому не вимикається:
 * локальна розробка вебхуків не отримує, і шлях стрічки мусить лишатись
 * робочим скрізь (Ц20).
 *
 * ── Порядок, і чому саме такий ──────────────────────────────────────────
 *
 *   токен з адреси → рядок зʼєднання (політика відкриває його за
 *                    `app.public_token`, міграція 0060) → немає: 404, хай
 *                    вендор не повторює — це не наш обʼєкт
 *   секрет із заголовка, порівняння постійного часу → 401, жодної роботи
 *   тіло: JSON з полем `event` → інакше 400 (4xx вендор не повторює)
 *   запис у cm_events під орендарем із рядка → 200
 *   власна аварія (база впала) → 500: це єдиний шанс отримати подію вдруге
 *
 * И7: до відповіді — жодної мережі. Пробудження йде через `after()` — після
 * того, як відповідь пішла, — і через засувку (`data/wake.ts`): один прохід
 * на зʼєднання за раз, пачка сигналів — один додатковий.
 */

export interface WebhookReceiverDeps {
  /** «Після відповіді». У застосунку — `after()` з Next; у перевірці підставляється. */
  defer(fn: () => void | Promise<void>): void;
  /** Що робити після відповіді: прохід стрічки ЦЬОГО зʼєднання під ЙОГО орендарем. */
  wake(connectionId: string, organizationId: string): Promise<void>;
}

type TokenParams = { params: Promise<{ token: string }> };

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (b.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function makeWebhookReceiver(deps: WebhookReceiverDeps) {
  return async function receiveWebhook(request: Request, { params }: TokenParams): Promise<Response> {
    const { token } = await params;
    const connection = await runWithPublicToken(token, () => connectionByWebhookToken(token));
    if (!connection) return Response.json({ error: 'Not found' }, { status: 404 });

    const given = request.headers.get('x-webhook-secret') ?? '';
    if (!sameSecret(given, connection.webhookSecret)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'body_not_json' }, { status: 400 });
    }
    const event = body && typeof body === 'object' && !Array.isArray(body) ? (body as { event?: unknown }).event : undefined;
    if (typeof event !== 'string' || !event) {
      return Response.json({ error: 'event_required' }, { status: 400 });
    }

    try {
      await runWithOrganization(connection.organizationId, () =>
        recordEvent({ connectionId: connection.id, organizationId: connection.organizationId, eventType: event, payload: body }));
    } catch (error: unknown) {
      // 5xx навмисно: вендор повторить, і подія не загубиться.
      console.error('[channels] webhook: could not record the event', error instanceof Error ? error.message : error);
      return Response.json({ error: 'Internal error' }, { status: 500 });
    }

    deps.defer(() => deps.wake(connection.id, connection.organizationId));
    return Response.json({ ok: true });
  };
}

/** Двері застосунку: «після відповіді» — Next, пробудження — засувка процесу. */
export const receiveChannelWebhook = makeWebhookReceiver({
  defer: (fn) => after(fn),
  wake: async (connectionId, organizationId) => {
    waker.request(connectionId, () => runWithOrganization(organizationId, async () => { await pullConnectionNow(connectionId); }));
  },
});
