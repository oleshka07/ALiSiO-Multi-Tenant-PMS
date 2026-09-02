/**
 * Засувка пробудження: один прохід стрічки на зʼєднання за раз.
 *
 * Вебхук — сигнал «опитай стрічку зараз» (сигнал, не дані: підпису у вендора
 * немає, тіло на віру не береться). Сигнали приходять пачками — десять
 * броней за секунду це десять сигналів, і десять паралельних проходів однієї
 * стрічки читали б ту саму сторінку десять разів, спалюючи бюджет обʼєкта
 * на дублікати (И10). Тому прохід іде один; сигнал під час проходу означає
 * «після цього — ще раз», і скільки б їх не прийшло, додатковий буде один.
 *
 * Засувка живе в памʼяті ПРОЦЕСУ, як і обмежувач темпу (Ц17): два контейнери
 * одного середовища мали б по своїй, і стрічка витримує це — дублікати вона
 * відсікає за ревізією, підтверджує після коміту. Коли зʼявиться другий
 * контейнер, і засувка, і обмежувач переїдуть у базу разом.
 *
 * Прохід, що впав, засувку відпускає — інакше одна помилка стрічки глушила б
 * сигнали назавжди; помилка при цьому називається, не ковтається.
 *
 * Засувка — не гарантія доставки: процес, що помер між відповіддю дверей і
 * проходом, губить сигнал безслідно. Ловить крон стрічки — тому він і не
 * вимикається. Вебхук пришвидшує, стрічка гарантує.
 */

export interface Waker {
  /**
   * Попросити прохід. `true` — прохід почався зараз; `false` — уже йде, і
   * після нього буде ще один. Ніколи не кидає і не чекає на прохід.
   */
  request(connectionId: string, run: () => Promise<void>): boolean;
  inFlight(connectionId: string): boolean;
}

interface Latch {
  running: boolean;
  /** Просили під час проходу — після нього йде ще один, останнім `run`. */
  again: (() => Promise<void>) | null;
}

export function createWaker(options: { onError: (error: unknown, connectionId: string) => void }): Waker {
  const latches = new Map<string, Latch>();

  const loop = async (connectionId: string, latch: Latch, run: () => Promise<void>) => {
    let next: (() => Promise<void>) | null = run;
    while (next) {
      const current = next;
      latch.again = null;
      try {
        await current();
      } catch (error) {
        options.onError(error, connectionId);
      }
      next = latch.again;
    }
    latch.running = false;
    latches.delete(connectionId);
  };

  return {
    request(connectionId, run) {
      const latch = latches.get(connectionId);
      if (latch?.running) {
        latch.again = run;
        return false;
      }
      const fresh: Latch = { running: true, again: null };
      latches.set(connectionId, fresh);
      void loop(connectionId, fresh, run);
      return true;
    },
    inFlight(connectionId) {
      return latches.get(connectionId)?.running ?? false;
    },
  };
}

/** Засувка процесу — одна на всі двері вебхука цього застосунку. */
export const waker: Waker = createWaker({
  onError: (error, connectionId) => {
    console.error(`[channels] wake pull failed for connection ${connectionId}:`, error instanceof Error ? error.message : error);
  },
});
