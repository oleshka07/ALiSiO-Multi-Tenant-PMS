import type { PullReport } from './pull-bookings.ts';

/**
 * Один прохід крона: усі готелі, усі ввімкнені зʼєднання.
 *
 * ── Чому цикл по готелях, а не один запит ───────────────────────────────
 *
 * Крон не має орендаря — він працює за всіх. Отже, орендар ставиться в
 * циклі, і ВСЯ робота по готелю живе всередині обгортки, а не поруч із нею.
 * Це не стиль: запит без контексту організації тут не падає. На Postgres він
 * повертає нуль рядків без помилки, крон рапортує «оброблено 0» і виглядає
 * здоровим доти, доки готель не спитає, чому броні не приходять уже тиждень.
 * Той самий шов, що в `cron/gdpr-retention` і `cron/abandoned-carts` — і там
 * він зʼявився після точно такої історії.
 *
 * ── Три роди «нічого не сталося» ────────────────────────────────────────
 *
 * Їх не можна плутати, і саме на цьому крони зазвичай і ламаються:
 *
 *   ПРОПУЩЕНО — готель не купував модуль каналів або вимкнув зʼєднання.
 *               Нормальний стан, мовчазний.
 *   ЗЛАМАНО   — модуль є, а ключа немає; стрічка не відповіла; база впала.
 *               Мусить дійти до оператора ненульовим `failedOrganizations`:
 *               `deploy/run-cron.sh` читає ТІЛО відповіді й падає саме на
 *               ньому, а не на коді HTTP.
 *   ПОРОЖНЬО  — усе працює, нових броней немає. Успіх.
 *
 * Злити перше з другим — крон, вічно зелений. Злити третє з другим — алерт
 * щохвилини, який навчаються ігнорувати.
 *
 * ── Падіння одного готелю не спиняє решту ───────────────────────────────
 *
 * Інакше перший зламаний клієнт забирає з собою всіх наступних: що гірший
 * стан в одного, то менше броней бачать інші.
 */

/** Усе, що торкається світу, приходить ззовні — щоб це можна було перевірити. */
export interface PullAllDeps<P = unknown> {
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
  /**
   * Хто обслуговує цього провайдера. `null` — код такого не знає.
   *
   * Значення провайдера лежить у базі, а список відомих — у коді, тож
   * розбіжність можлива: недокочена міграція, зʼєднання, заведене руками.
   * Це помилка з назвою, а не тихий пропуск.
   */
  pullerFor(provider: string): P | null;
  /** Прочитати стрічку одного зʼєднання і завести броні. */
  pull(puller: P, connectionId: string, apiKey: string): Promise<PullReport>;
}

export interface PullAllFailure {
  organizationId: string;
  connectionId?: string;
  reason: string;
}

export interface PullAllReport {
  /** Готелів, які взагалі опитувались. */
  organizations: number;
  /** Готелів без модуля каналів або без увімкнених зʼєднань. */
  skippedOrganizations: number;
  connections: number;
  seen: number;
  applied: number;
  duplicates: number;
  acked: number;
  /** Ревізії, які не застосувались; кожна названа. */
  skipped: number;
  /** Ненульове — крон ЧЕРВОНИЙ. */
  failedOrganizations: number;
  failures: PullAllFailure[];
}

export async function pullAllConnections<P>(deps: PullAllDeps<P>): Promise<PullAllReport> {
  const report: PullAllReport = {
    organizations: 0,
    skippedOrganizations: 0,
    connections: 0,
    seen: 0,
    applied: 0,
    duplicates: 0,
    acked: 0,
    skipped: 0,
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
        const enabled = (await deps.connections(organizationId)).filter((c) => c.isEnabled);
        if (enabled.length === 0) {
          report.skippedOrganizations++;
          return;
        }

        // Модуль є, зʼєднання ввімкнене, а ключа немає — це найтихіший стан
        // з усіх і саме тому ПОМИЛКА. Мовчазний пропуск дав би вічно зелений
        // крон і готель, який тиждень не бачить своїх броней.
        const apiKey = await deps.apiKey(organizationId);
        if (!apiKey) {
          fail('missing_api_key');
          return;
        }

        report.organizations++;

        for (const conn of enabled) {
          report.connections++;

          // Провайдер із бази, якого код не знає. Побачити це має оператор, а
          // не наступний розробник через півроку: мовчазний пропуск дав би
          // готель, чиї броні не приходять, і крон, який каже «все добре».
          const puller = deps.pullerFor(conn.provider);
          if (!puller) {
            fail('unknown_provider', conn.id);
            continue;
          }

          try {
            const got = await deps.pull(puller, conn.id, apiKey);
            report.seen += got.seen;
            report.applied += got.applied;
            report.duplicates += got.duplicates;
            report.acked += got.acked;
            report.skipped += got.skipped.length;
          } catch (e) {
            // Помилка одного зʼєднання не спиняє інші зʼєднання того ж
            // готелю — і тим більше інші готелі.
            fail(`pull_failed:${e instanceof Error ? e.message : 'unknown'}`, conn.id);
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
