/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '../db/async.ts';

/**
 * Дії, які лічильник розрізняє.
 *
 * Перелік, а не `string`, навмисно: `action` — це половина ключа, за яким
 * рахуються спроби, і друкарська помилка в ній дала б окреме, порожнє відро.
 * Ліміт «3 на 5 хвилин» тоді нічого не обмежує, і помітити це можна лише
 * зловживанням.
 */
export type RateLimitedAction = 'service_order' | 'registration' | 'payment_request';

/**
 * Check rate limit for a given token + action.
 * Returns { allowed: boolean, remaining: number }
 *
 * ── Чому час пишеться руками ─────────────────────────────────────────────
 *
 * `created_at` мала `DEFAULT (datetime('now'))`, і SQLite писала
 * `'2026-08-27 19:34:12'` — через ПРОБІЛ. Відсічка рахувалась як
 * `new Date(...).toISOString()`, тобто `'2026-08-27T19:29:22.323Z'` — через
 * `T`. У SQLite це два TEXT, і порівнюються вони посимвольно: пробіл (0x20)
 * менший за `T` (0x54), тож КОЖЕН збережений рядок виходив «старішим» за
 * будь-яку відсічку. `COUNT(*)` завжди 0, ліміт не спрацьовував ніколи.
 *
 * Це не теорія: перевірено живим запитом — чотири поспіль (при ліміті 3) дали
 * чотири 200, і в таблиці лежало сім записів, з яких запит бачив нуль.
 *
 * На Postgres колонка `TIMESTAMPTZ`, і там параметр приводиться до часу, тож
 * порівняння працювало. Тобто ліміт стояв на бойовій базі й не стояв на
 * SQLite — а SQLite це кожна машина розробника, `npm run dev` і завдання
 * `live` у CI. Обмеження публічного маршруту, яке не працює саме там, де його
 * пробують, — гірше за відсутнє: воно виглядає зробленим.
 *
 * Тепер обидві половини — один ISO-рядок. SQLite порівнює їх як текст
 * правильно (ISO-8601 лексикографічно впорядкований), Postgres приводить
 * обидві до `timestamptz`. Старі рядки з пробілом лишаються «старішими» за
 * будь-яку відсічку — для лічильника вікна це безпечний бік: вони й справді
 * поза вікном.
 */
export async function checkRateLimit(
  token: string,
  action: RateLimitedAction,
  maxRequests: number,
  windowMinutes: number
): Promise<{ allowed: boolean; remaining: number }> {
  const sql = getSql();

  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMinutes * 60 * 1000).toISOString();
  const count = (await sql.row<any>('SELECT COUNT(*) as cnt FROM rate_limits WHERE token = ? AND action = ? AND created_at > ?', [token, action, cutoff]) as any)?.cnt || 0;

  if (count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  // Час називається явно, а не лишається на DEFAULT колонки: саме розбіжність
  // між форматом DEFAULT-у і форматом відсічки й ламала перевірку.
  await sql.run('INSERT INTO rate_limits (token, action, created_at) VALUES (?, ?, ?)', [token, action, now.toISOString()]);

  return { allowed: true, remaining: maxRequests - count - 1 };
}
