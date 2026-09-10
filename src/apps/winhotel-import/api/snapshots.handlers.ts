/**
 * Знімок Winhotel: прийом від агента (без сесії, за токеном) і картка
 * застосунку (власник).
 *
 * ── Прийом — публічний маршрут, право доводить токен ────────────────────
 *
 * `POST /api/apps/winhotel-import/snapshots`, тіло — сам файл (gzip),
 * поля — у заголовках:
 *
 *   Authorization:          Bearer <організація>.<секрет>   (agent-token.ts)
 *   X-Winhotel-Sha256:      sha256 ТІЛА, hex — звіряється під час прийому
 *   X-Winhotel-Mode:        backup | gbak | copy             (режим агента)
 *   X-Winhotel-Taken-At:    ISO-час знімка
 *   X-Winhotel-Hostname:    імʼя машини готелю — лише в лог відмови, не в базу
 *
 * Порядок відмов — до першого байта на диску: без токена або з чужим — 401;
 * токен справжній, але застосунок у цієї організації вимкнено — 404 (не 403,
 * інваріант 5: вимкнений застосунок для агента не існує). Далі — під
 * `runWithOrganization` тієї організації, яку токен назвав.
 *
 * Тіло — потоком у файл (`.part`), не в памʼять: знімок — 77 МБ gzip. Хеш
 * рахується по дорозі; розбіжність із заголовком → 400, файл видалено, рядка
 * немає. Той самий sha256 удруге → 200 з тим самим id, файл не читається.
 * Другий інший знімок за ту саму добу → 409 (§2.2: один на добу).
 *
 * `reportOk` після прийому; `reportError` з НАШИМ текстом на кожній відмові,
 * яку можна приписати організації (інваріант 6 — не `e.message`).
 *
 * ── Картка — власник ────────────────────────────────────────────────────
 *
 * `POST …/token` — новий токен (старий перестає діяти), значення один раз;
 * `GET …/snapshots` — останні 10 і стан останнього, з читанням маркерів
 * мосту; `POST …/snapshots/<id>/import` — імпорт у ядро (частина Б; тут
 * поки названа відмова, не мовчазний успіх).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { NextResponse } from 'next/server';
import { withOwner, type Actor } from '@core/auth/session';
import { runWithOrganization } from '@core/auth/tenant-context';
import { hasFeature } from '@core/features';
import { handleError, refuse } from '@core/http/errors';
import { reportError, reportOk } from '@core/app-connections';
import { hasAgentToken, issueAgentToken, organizationByAgentToken } from '../data/agent-token';
import {
  SNAPSHOT_MODES,
  findSnapshot,
  findSnapshotBySha,
  insertSnapshot,
  listSnapshots,
  newSnapshotId,
  snapshotsReceivedToday,
  syncMarkers,
  type SnapshotMode,
  type SnapshotRow,
} from '../data/snapshots.repo';
import { discardSnapshotFiles, ensureDir, snapshotPaths } from '../storage';

const APP = 'winhotel_import';
const SHA_HEX = /^[0-9a-f]{64}$/;

/**
 * Відмова, яку організація побачить на картці, — і той самий текст клієнту.
 * Статус — літералом у кожній гілці: `check-refusal-status` читає число, а не
 * тип, і `refuse(msg, status)` зі змінною для нього — статус невідомий.
 */
async function refuseReported(organizationId: string, message: string, status: 400 | 409): Promise<never> {
  await reportError(APP, organizationId, message);
  if (status === 409) refuse(message, 409);
  return refuse(message, 400);
}

function takenAtFrom(header: string | null): string | null {
  if (!header) return null;
  const ms = Date.parse(header);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** Прийняти тіло у файл, рахуючи sha256 і розмір по дорозі. */
async function receiveBody(body: ReadableStream<Uint8Array> | null, target: string): Promise<{ sha256: string; size: number }> {
  if (!body) return { sha256: '', size: 0 };
  const hash = crypto.createHash('sha256');
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      size += chunk.length;
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>), counter, fs.createWriteStream(target));
  return { sha256: hash.digest('hex'), size };
}

export async function receiveSnapshot(request: Request): Promise<Response> {
  try {
    const organizationId = await organizationByAgentToken(request.headers.get('authorization'));
    if (!organizationId) refuse('Немає дійсного токена агента', 401);
    if (!(await hasFeature(organizationId, 'winhotel_import'))) refuse('Не знайдено', 404);

    return await runWithOrganization(organizationId, async () => {
      const sha256 = (request.headers.get('x-winhotel-sha256') ?? '').trim().toLowerCase();
      if (!SHA_HEX.test(sha256)) await refuseReported(organizationId, 'Заголовок X-Winhotel-Sha256 має бути sha256 у hex', 400);
      const mode = (request.headers.get('x-winhotel-mode') ?? '').trim().toLowerCase() as SnapshotMode;
      if (!SNAPSHOT_MODES.includes(mode)) await refuseReported(organizationId, `Режим знімка «${mode || '—'}» невідомий: очікуємо backup, gbak або copy`, 400);
      const takenAt = takenAtFrom(request.headers.get('x-winhotel-taken-at'));

      const same = await findSnapshotBySha(organizationId, sha256);
      if (same) {
        return NextResponse.json({ snapshotId: same.id, status: same.status, duplicate: true }, { status: 200 });
      }
      const today = await snapshotsReceivedToday(organizationId);
      if (today.length) {
        await refuseReported(organizationId, `За сьогодні знімок уже прийнято (${today[0].id}); наступний — завтра`, 409);
      }

      const id = newSnapshotId();
      const p = snapshotPaths(organizationId, id);
      ensureDir(p.dir);
      let received: { sha256: string; size: number };
      try {
        received = await receiveBody(request.body, p.part);
      } catch (e) {
        discardSnapshotFiles(p);
        throw e;
      }
      if (received.size === 0) {
        discardSnapshotFiles(p);
        await refuseReported(organizationId, 'Порожнє тіло: знімок не надійшов', 400);
      }
      if (received.sha256 !== sha256) {
        discardSnapshotFiles(p);
        const host = (request.headers.get('x-winhotel-hostname') ?? '').slice(0, 60);
        console.error(`[winhotel-import] ${organizationId}: sha256 не збігся (${received.size} байт${host ? `, ${host}` : ''})`);
        await refuseReported(organizationId, 'Контрольна сума не збігається із заголовком — файл пошкоджено дорогою', 400);
      }

      fs.renameSync(p.part, p.archive);
      try {
        await insertSnapshot({ id, organizationId, takenAt, mode, sha256, sizeBytes: received.size });
      } catch (e) {
        // Два агенти принесли те саме одночасно: унікальний індекс по
        // (організація, sha256) лишив один рядок — віддаємо його, свій файл
        // прибираємо.
        discardSnapshotFiles(p);
        const winner = await findSnapshotBySha(organizationId, sha256);
        if (winner) return NextResponse.json({ snapshotId: winner.id, status: winner.status, duplicate: true }, { status: 200 });
        throw e;
      }
      // `.ready` — останнім: міст бере лише файл, за який хтось поручився.
      fs.writeFileSync(p.ready, JSON.stringify({ id, mode, sha256, takenAt, sizeBytes: received.size }));
      await reportOk(APP, organizationId);
      return NextResponse.json({ snapshotId: id, status: 'received' }, { status: 201 });
    });
  } catch (e) {
    return handleError('winhotel-import/snapshots', e);
  }
}

// ─── Картка (власник) ────────────────────────────────────────────────────

export const createAgentToken = withOwner(async (_req, _ctx, actor: Actor) => {
  try {
    const token = await issueAgentToken(actor.organizationId);
    return NextResponse.json({ token }, { status: 201 });
  } catch (e) {
    return handleError('winhotel-import/token', e);
  }
});

export interface SnapshotCard {
  hasToken: boolean;
  last: SnapshotRow | null;
  snapshots: SnapshotRow[];
}

export const getSnapshots = withOwner(async (_req, _ctx, actor: Actor) => {
  try {
    const org = actor.organizationId;
    await syncMarkers(org);
    const [hasToken, snapshots] = await Promise.all([hasAgentToken(org), listSnapshots(org, 10)]);
    const card: SnapshotCard = { hasToken, last: snapshots[0] ?? null, snapshots };
    return NextResponse.json(card);
  } catch (e) {
    return handleError('winhotel-import/snapshots', e);
  }
});

/**
 * Імпорт у ядро — частина Б задачі. Кнопка на картці є вже, бо стан
 * `extracted` без неї — глухий кут; але вона не вдає успіху: знімок
 * перевіряється (свій, витягнутий), і відповідь називає, чого бракує.
 */
export const importSnapshot = withOwner(async (_req, ctx: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const { id } = await ctx.params;
    const org = actor.organizationId;
    await syncMarkers(org);
    const row = await findSnapshot(org, id);
    if (!row) refuse('Не знайдено', 404);
    if (row.status !== 'extracted') refuse(`Знімок у стані «${row.status}» — імпортувати можна лише витягнутий`, 409);
    refuse('Імпорт у ядро ще не підключений: це частина Б задачі winhotel-import; знімок витягнутий і чекає', 409);
  } catch (e) {
    return handleError('winhotel-import/import', e);
  }
});
