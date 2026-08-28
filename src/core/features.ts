/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql, type Sql } from './db/async.ts';

/**
 * The feature registry: which parts of the product this organization has.
 *
 * One question, asked from both sides. The sidebar hides the menu item and the
 * route refuses the request off the SAME row in organization_features, so a
 * feature an organization does not have is invisible to it, not merely
 * de-linked.
 *
 * ── Дві родини ключів, і чому в них різні дефолти ───────────────────────
 *
 * Спочатку тут були лише інтеграції — те, що готель ДОКУПОВУЄ. Для них
 * «немає рядка = вимкнено» правильно: новий клієнт не має отримати німецьку
 * фіскалізацію тому, що про неї забули.
 *
 * Модулі — інша річ. «Задачі», «Зали», «Аркуші дня», «Аналітика» і
 * «Dashboard» це не покупка, а частини PMS, які одному готелю потрібні, а
 * іншому ні. Якби вони теж читались як «немає рядка = вимкнено», то в день
 * додавання ключа кожен уже наявний готель втратив би пʼять розділів меню
 * мовчки — саме тому, що ніхто не завів їм рядків.
 *
 * Тому дефолт живе поруч із ключем, а не в одному правилі на всіх. `ON`
 * означає «модуль є, поки готель його не вимкнув»; явний рядок `enabled = 0`
 * завжди сильніший за дефолт.
 */

/** OFF: докуповується. ON: частина PMS, яку готель може вимкнути. */
const OFF = false;
const ON = true;

export const FEATURE_SPEC = {
  widget: { label: 'Віджет бронювання і сайти', on: OFF },
  // Німецька фіскалізація (KassenSichV/TSE). Поки вимкнена, DE-готель НЕ
  // може записати готівку чи карту-на-рецепції — інакше PMS тихо стала б
  // незареєстрованою касою (docs/TSE-KASSENSICHV.md §6.4, блок A). Дефолт ON
  // тут був би не зручністю, а незареєстрованою касою в кожного клієнта.
  fiscal_de: { label: 'Фіскалізація Німеччини (TSE)', on: OFF },
  // Приймання оплат онлайн. Вимкнено — і поки жоден шлюз не написаний,
  // увімкнення лише відкриває екран, де готель обирає провайдера й зберігає
  // свої ключі. Списати картку продукт сьогодні не вміє: див. `live` у
  // src/core/payments.ts.
  online_payments: { label: 'Онлайн-оплата', on: OFF },

  // ── Модулі PMS ────────────────────────────────────────────────────────
  // Кожен — свій каталог під src/modules/. Вимикається готелем, не продавцем.
  /** Задачі персоналу: хаускіпінг, технічна служба, чек-листи. */
  tasks: { label: 'Задачі персоналу', on: ON },
  /** Зали й заходи: погодинна оренда, розсадка, кейтеринг. */
  events: { label: 'Зали та заходи', on: ON },
  /** Аналітика продажів: заповненість, ADR, RevPAR, канали. */
  reports: { label: 'Аналітика продажів', on: ON },
  /** Дашборди. Різні для власника, адміністратора, інвестора. */
  dashboard: { label: 'Дашборди', on: ON },
  /** Аркуші дня: чотири друковані списки, які рецепція друкує щоранку. */
  day_sheets: { label: 'Аркуші дня', on: ON },
  /**
   * Фактурування: фоліо, рахунки, серії нумерації, ставки ПДВ, каса,
   * фіскалізація.
   *
   * ON, і це не за інерцією. Готель, який здає номери, виписує документ —
   * питання лише, чиїм бланком. Дефолт OFF означав би, що в день появи
   * ключа кожен наявний клієнт мовчки втратив фактури, а новий не зміг би
   * закрити перший заїзд.
   *
   * Вимикається окремим готелем — тим, хто веде фактури деінде (мережа з
   * власною бухгалтерією, франшиза). Тоді зникають і екрани, і маршрути:
   * `withModule('invoicing', …)` відмовляє на сервері, а не лише ховає
   * пункт меню.
   */
  invoicing: { label: 'Фактурування і каса', on: ON },
} as const;

export type FeatureKey = keyof typeof FEATURE_SPEC;

/**
 * Ключ → назва. Те, що бачить екран налаштувань і `/api/settings/features`.
 *
 * Окремою мапою, а не `FEATURE_SPEC` цілком: каталог їде клієнту, і дефолти
 * там ні до чого — стан кожного ключа для ЦІЄЇ організації приходить поруч,
 * уже порахований.
 */
export const FEATURES = Object.fromEntries(
  Object.entries(FEATURE_SPEC).map(([k, v]) => [k, v.label]),
) as Record<FeatureKey, string>;

/** Чи модуль стоїть у клієнта, поки він явно не сказав інакше. */
export function featureDefault(feature: FeatureKey): boolean {
  return FEATURE_SPEC[feature].on;
}

export async function hasFeature(organizationId: string, feature: FeatureKey): Promise<boolean> {
  const sql = getSql();
  const row = await sql.row<any>('SELECT enabled FROM organization_features WHERE organization_id = ? AND feature = ?', [organizationId, feature]) as { enabled: number } | undefined;
  // Рядок сильніший за дефолт — і `enabled = 0` теж рядок. Інакше вимкнути
  // модуль, який стоїть за замовчуванням, було б неможливо.
  if (row) return row.enabled === 1;
  return featureDefault(feature);
}

/** Every feature with its state — for the settings screen and /api/auth/me. */
export async function listFeatures(organizationId: string): Promise<Record<FeatureKey, boolean>> {
  const out = {} as Record<FeatureKey, boolean>;
  for (const key of Object.keys(FEATURES) as FeatureKey[]) {
    out[key] = await hasFeature(organizationId, key);
  }
  return out;
}

/** `handle` is for a caller already inside a transaction — see provisioning. */
export async function setFeature(organizationId: string, feature: FeatureKey, enabled: boolean, handle?: Sql): Promise<void> {
  const sql = handle ?? getSql();
  await sql.run(`
    INSERT INTO organization_features (organization_id, feature, enabled, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(organization_id, feature)
    DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
  `, [organizationId, feature, enabled ? 1 : 0]);
}

/**
 * The refusal a handler returns when the organization lacks the feature.
 *
 * A plain Response, not NextResponse: importing 'next/server' here would make
 * the whole registry unloadable outside the bundler, and provisioning needs to
 * write feature rows from a plain node script. Next accepts either.
 */
export function featureDisabled(feature: FeatureKey, headers?: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: `Feature "${feature}" is not enabled for this organization` }),
    { status: 403, headers: { 'Content-Type': 'application/json', ...(headers || {}) } },
  );
}
