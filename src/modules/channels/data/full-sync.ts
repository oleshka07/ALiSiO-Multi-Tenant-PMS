/**
 * Повний синк (П5): весь стан зʼєднання — у чергу, одним діапазоном на адресата.
 *
 *   node src/modules/channels/channex/full-sync.check.ts
 *
 * Вендор каже прямо: «a full sync would be 2 API calls» — 500 ночей
 * наявності для всіх типів одним викликом, 500 ночей цін і обмежень для
 * всіх тарифів другим (INVENTORY §4.4, §5.5 ТЗ). Це не окремий транспорт і
 * не висипання 500 × N координат: черга тримає ДІАПАЗОНИ (Ц15), тож повний
 * синк — це один рядок на змаплений тип номера і один на змаплену пару
 * тип × тариф (Ц10), від сьогодні до горизонту (`OUTBOX_HORIZON_DAYS`).
 * Далі працює той самий батчер, що й для дельт: розкладає по ночах, читає
 * поточні числа з джерел, стискає в діапазони і шле одним тілом на смугу —
 * рівно два виклики, з розписками на рядках (П6) і звіркою назад.
 *
 * ── Коли ────────────────────────────────────────────────────────────────
 *
 * Рукою оператора (кнопка в майстрі) і при ввімкненні розсилки. НІКОЛИ за
 * таймером: тест 13 сертифікації відкидає «logic that just sends full sync
 * on a timer basis», а стан без нього тримають черга дельт і звірка (И6,
 * Ц23; гейт `check-no-timer-fullsync.mjs`).
 *
 * ── Що вважається зробленим ─────────────────────────────────────────────
 *
 * `last_full_sync_at` ставиться лише коли прохід нічого не повернув у чергу:
 * половина стану, що поїхала, — це не повний синк, а дельта з дірками, і
 * дата на зʼєднанні брехала б оператору. Повернуте лишається в черзі й
 * поїде наступним проходом — але «зроблено» скаже лише той прохід, який
 * справді довіз усе.
 */
import { getSql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { connectionInTenant, rememberFullSync } from './connections.repo';
import { connectionMirror } from './mappings.repo';
import { enqueueChange, recentSends, OUTBOX_HORIZON_DAYS } from './outbox.repo';
import { addDays } from './outbox-notes';
import type { FlushReport } from '../domain/ari-batch.ts';

export interface FullSyncPlan {
  from: string;
  /** Остання ніч включно — горизонт. */
  to: string;
  /** Скільки типів номерів отримало координату наявності. */
  unitTypes: number;
  /** Скільки пар тип × тариф отримало координату ціни. */
  pairs: number;
}

export interface FullSyncReport {
  plan: FullSyncPlan;
  flush: FlushReport;
  /** Розписки вендора на рядках повного синку — по одній на смугу, якщо все поїхало. */
  receipts: string[];
  /** Коли повний синк ЗАВЕРШИВСЯ; `null` — щось повернулось у чергу, дата не ставиться. */
  completedAt: string | null;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Покласти весь стан у чергу. Повторний виклик рядків не подвоює — індекс
 * злиття тримає координату (Ц13); тип чи пара, яких немає в дзеркалі,
 * координати не отримують — їм нема кому адресувати.
 */
export async function enqueueFullSync(connectionId: string, today: string = todayIso()): Promise<FullSyncPlan> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('full sync: without a tenant');
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('full sync: connection not found');
  if (!connection.remotePropertyId) throw new Error('catalog not synced: the connection has no remote property yet');

  const mirror = await connectionMirror(connectionId);
  const from = today;
  const to = addDays(today, OUTBOX_HORIZON_DAYS - 1);
  const plan: FullSyncPlan = { from, to, unitTypes: 0, pairs: 0 };

  const sql = getSql();
  await sql.tx(async (t) => {
    for (const m of mirror) {
      if (m.entityType === 'unit_type') {
        await enqueueChange(t, connectionId, { kind: 'availability', unitTypeId: m.localId, date: from, dateTo: to });
        plan.unitTypes++;
      } else if (m.entityType === 'rate_plan') {
        await enqueueChange(t, connectionId, { kind: 'rate', unitTypeId: m.unitTypeId, ratePlanId: m.localId, date: from, dateTo: to });
        plan.pairs++;
      }
    }
  });
  return plan;
}

/**
 * Повний синк цілком: у чергу → один прохід → розписки → дата, якщо все поїхало.
 *
 * Прохід передається ззовні (`publish`): двері модуля дають справжній,
 * перевірка — з підставленим транспортом. Так «дата лише коли все поїхало»
 * доводиться без жодного виклику до вендора.
 */
export async function runFullSync(
  connectionId: string,
  publish: (connectionId: string) => Promise<FlushReport>,
  today: string = todayIso(),
): Promise<FullSyncReport> {
  const plan = await enqueueFullSync(connectionId, today);
  const flush = await publish(connectionId);

  const ours = (await recentSends(connectionId, Math.max(plan.unitTypes + plan.pairs, 1)))
    .filter((r) => r.date === plan.from && r.dateTo === plan.to);
  const receipts = [...new Set(ours.flatMap((r) => (r.receipt ?? '').split(',').filter(Boolean)))];

  let completedAt: string | null = null;
  const addressed = plan.unitTypes + plan.pairs;
  if (addressed > 0 && flush.failed === 0 && flush.needsAttention === 0 && ours.length === addressed) {
    completedAt = await rememberFullSync(connectionId);
  }
  return { plan, flush, receipts, completedAt };
}
