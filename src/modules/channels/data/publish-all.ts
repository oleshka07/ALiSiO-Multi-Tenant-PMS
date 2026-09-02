import type { FlushReport } from '../domain/ari-batch.ts';

/**
 * Прохід крона розсилки по всіх зʼєднаннях усіх готелів.
 *
 *   node src/modules/channels/data/publish-all.check.ts
 *
 * Дзеркало `pull-all.ts`, тієї самої форми: організації → модуль → орендар →
 * увімкнені зʼєднання → ключ → провайдер → один прохід батчера. Розкладка
 * «пропущено / зламано / порожньо» — тут, і кожна названа: готель без модуля
 * пропускається мовчки, вимкнене зʼєднання не чіпається (черга його чекає),
 * відсутній ключ і невідомий провайдер — провал із назвою, падіння одного
 * зʼєднання не спиняє решту.
 *
 * ── «Потребує уваги» доповідається, але крон від нього не червоніє ───────
 *
 * Застрягла координата (Ц14) — справа екрана оператора, не крона: червоний
 * крон щохвилини на тиждень — це крон, який усі вчаться ігнорувати, і разом
 * із ним ігнорують справжній провал (ключ, провайдер, падіння). Тому
 * `needsAttention` лежить у доповіді поіменно, а `failedOrganizations` рахує
 * лише те, що не дає проходу відбутись.
 *
 * ── Пауза після помилки — це і є розклад ────────────────────────────────
 *
 * Вендор просить після помилки не чіпати обʼєкт хвилину. Обмежувач один на
 * процес і ключований зʼєднанням (`sharedChannexLimiter`), тож прохід крона
 * раз на хвилину і ручний «повторити» ділять один бюджет обʼєкта; крон
 * частіший за хвилину не дав би паузі статись.
 */
export interface PublishAllDeps<P = unknown> {
  /** Усі організації сервера. */
  organizations(): Promise<string[]>;
  /** Чи куплений модуль каналів. */
  hasChannels(organizationId: string): Promise<boolean>;
  /** Поставити орендаря на весь час роботи по цьому готелю. */
  withOrganization<T>(organizationId: string, fn: () => Promise<T>): Promise<T>;
  /** Зʼєднання цього готелю. Викликається ВСЕРЕДИНІ `withOrganization`. */
  connections(organizationId: string): Promise<{ id: string; provider: string; isEnabled: boolean }[]>;
  /** Ключ API готелю, або `null`, якщо його немає. */
  apiKey(organizationId: string): Promise<string | null>;
  /** Хто розсилає для цього провайдера. `null` — код такого не знає. */
  publisherFor(provider: string): P | null;
  /** Один прохід батчера по одному зʼєднанню. */
  publish(publisher: P, connectionId: string, apiKey: string): Promise<FlushReport>;
}

export interface PublishAllFailure {
  organizationId: string;
  connectionId?: string;
  reason: string;
}

export interface PublishAllReport {
  /** Готелів, які взагалі оброблялись. */
  organizations: number;
  /** Готелів без модуля каналів або без увімкнених зʼєднань. */
  skippedOrganizations: number;
  connections: number;
  sent: number;
  failed: number;
  retired: number;
  /** Координат, що стали «потребує уваги» цим проходом. Не червонить крон. */
  needsAttention: number;
  /** Викликів до менеджерів каналів — те, що витрачає бюджет обʼєктів. */
  calls: number;
  /** Причини повернень, з іменем зʼєднання. */
  errors: string[];
  /** Хто саме потребує уваги — для екрана і для журналу. */
  attention: { organizationId: string; connectionId: string; needsAttention: number }[];
  /** Ненульове — крон ЧЕРВОНИЙ. */
  failedOrganizations: number;
  failures: PublishAllFailure[];
}

export async function publishAllConnections<P>(deps: PublishAllDeps<P>): Promise<PublishAllReport> {
  const report: PublishAllReport = {
    organizations: 0,
    skippedOrganizations: 0,
    connections: 0,
    sent: 0,
    failed: 0,
    retired: 0,
    needsAttention: 0,
    calls: 0,
    errors: [],
    attention: [],
    failedOrganizations: 0,
    failures: [],
  };

  for (const organizationId of await deps.organizations()) {
    // Модуля немає — готель його не купував. Тихо далі.
    if (!await deps.hasChannels(organizationId)) {
      report.skippedOrganizations++;
      continue;
    }

    let failedHere = false;
    const fail = (reason: string, connectionId?: string) => {
      if (!failedHere) { report.failedOrganizations++; failedHere = true; }
      report.failures.push({ organizationId, connectionId, reason });
    };

    try {
      await deps.withOrganization(organizationId, async () => {
        // Вимкнене зʼєднання не чіпається — і черги не втрачає: батчер сам
        // би відмовив (8в), але ходити до нього нема чого.
        const enabled = (await deps.connections(organizationId)).filter((c) => c.isEnabled);
        if (enabled.length === 0) {
          report.skippedOrganizations++;
          return;
        }

        // Модуль є, зʼєднання ввімкнене, а ключа немає — черга росте, канал
        // мовчить, помилки ніде. Найтихіший стан, і саме тому провал.
        const apiKey = await deps.apiKey(organizationId);
        if (!apiKey) {
          fail('missing_api_key');
          return;
        }

        report.organizations++;

        for (const conn of enabled) {
          report.connections++;

          const publisher = deps.publisherFor(conn.provider);
          if (!publisher) {
            fail('unknown_provider', conn.id);
            continue;
          }

          try {
            const got = await deps.publish(publisher, conn.id, apiKey);
            report.sent += got.sent;
            report.failed += got.failed;
            report.retired += got.retired;
            report.calls += got.calls;
            report.needsAttention += got.needsAttention;
            for (const e of got.errors) report.errors.push(`${conn.id}: ${e}`);
            if (got.needsAttention > 0) {
              report.attention.push({ organizationId, connectionId: conn.id, needsAttention: got.needsAttention });
            }
          } catch (e) {
            // Помилка одного зʼєднання не спиняє інші зʼєднання того ж
            // готелю — і тим більше інші готелі.
            fail(`publish_failed:${e instanceof Error ? e.message : 'unknown'}`, conn.id);
          }
        }
      });
    } catch (e) {
      // Впало саме встановлення орендаря або читання списку зʼєднань.
      fail(`organization_failed:${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  return report;
}
