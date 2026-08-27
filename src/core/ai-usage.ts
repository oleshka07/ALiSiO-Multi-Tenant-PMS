/**
 * Скільки токенів моделі витратив цей готель.
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * OpenAI кличеться з двох місць — розпізнавання документа гостя і машинний
 * переклад контенту, — і обидва йдуть ключем СЕРВЕРА, спільним на всіх
 * клієнтів. Рахунок від OpenAI приходить один; витрачають його різні готелі.
 * Досі не існувало способу сказати, хто скільки, а отже й способу це
 * перевиставити.
 *
 * ── Чому це не ламає виклик ─────────────────────────────────────────────
 *
 * `record()` ніколи не кидає. Гість, який фотографує паспорт, не має отримати
 * помилку через те, що ми не змогли записати рядок обліку: розпізнавання вже
 * відбулося, гроші вже витрачені, і зіпсувати гостю реєстрацію заради власної
 * бухгалтерії — найгірший з можливих обмінів. Невдалий запис іде в
 * `console.error` і на цьому все.
 *
 * Зворотний бік чесно названий: облік best-effort. Якщо база лежала, витрату
 * не порахують. Альтернатива — падати перед гостем — гірша, а надійний облік
 * платежів робиться не так і не тут.
 *
 * ── Межі ────────────────────────────────────────────────────────────────
 *
 * `organization_id` називається явно (інваріант 12) і NOT NULL: рядок без
 * орендаря — це витрата, яку не виставити нікому, тобто рівно те, що ця
 * таблиця мала прибрати.
 *
 * Викликати треба ВСЕРЕДИНІ контексту орендаря (`runWithOrganization`), як і
 * будь-який інший запис у scoped-таблицю: на Postgres політика інакше відхилить
 * рядок. Усі теперішні виклики приходять з-під guard-а, тож контекст уже є.
 */
import { getSql } from './db/async.ts';

/** Що саме робили. Рядок, а не enum: нова функція з моделлю не має вимагати міграції. */
export type AiFeature = 'ocr_document' | 'translate_content' | (string & {});

/** Те, що OpenAI віддає в полі `usage`. Будь-яка половина може бути відсутня. */
export interface TokenUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
}

/**
 * Записати один виклик моделі.
 *
 * `total` рахується сам, якщо модель його не назвала: підсумок за місяць
 * читається саме з цієї колонки, і нуль у ній через відсутнє поле відповіді
 * означав би безкоштовний виклик.
 */
export async function recordAiUsage(
  organizationId: string,
  feature: AiFeature,
  model: string,
  usage: TokenUsage | null | undefined,
): Promise<void> {
  try {
    if (!organizationId) return;
    const prompt = n(usage?.prompt_tokens);
    const completion = n(usage?.completion_tokens);
    const total = n(usage?.total_tokens) || prompt + completion;
    if (total === 0) return; // нічого не витратили — нічого й записувати

    // `created_at` називається явно, і це не стиль. У SQLite колонка має
    // DEFAULT (datetime('now')) — рядок через ПРОБІЛ; у Postgres дефолту немає
    // взагалі, тож INSERT без цієї колонки впав би на NOT NULL — тобто працював
    // би в розробці й мовчки не рахував нічого на проді. Той самий формат з
    // обох боків, названий тут один раз (урок rate-limit.ts).
    await getSql().run(`
      INSERT INTO ai_usage (organization_id, feature, model, prompt_tokens, completion_tokens, total_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [organizationId, feature, model, prompt, completion, total, new Date().toISOString()]);
  } catch (e) {
    console.error('[ai-usage] не записано:', (e as Error).message);
  }
}

export interface AiUsageSummary {
  /** 'YYYY-MM'. */
  month: string;
  totalTokens: number;
  byFeature: { feature: string; model: string; tokens: number; calls: number }[];
}

/**
 * Підсумок за місяць для однієї організації.
 *
 * `substr(created_at, 1, 7)`, а не функції дат: колонка — ISO-рядок і на
 * SQLite, і на Postgres (там TEXT після pg-schema), а `strftime` не існує в
 * Postgres, `to_char` — у SQLite. Зріз рядка розуміють обидва.
 */
export async function aiUsageForMonth(organizationId: string, month: string): Promise<AiUsageSummary> {
  const sql = getSql();
  const rows = await sql.rows<any>(`
    SELECT feature, model,
           SUM(total_tokens) AS tokens,
           COUNT(*) AS calls
      FROM ai_usage
     WHERE organization_id = ? AND substr(created_at, 1, 7) = ?
     GROUP BY feature, model
     ORDER BY tokens DESC
  `, [organizationId, month]);

  const byFeature = rows.map((r: any) => ({
    feature: String(r.feature),
    model: String(r.model),
    tokens: Number(r.tokens) || 0,
    calls: Number(r.calls) || 0,
  }));
  return {
    month,
    totalTokens: byFeature.reduce((s, r) => s + r.tokens, 0),
    byFeature,
  };
}
