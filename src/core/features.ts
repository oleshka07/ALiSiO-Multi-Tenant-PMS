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
  // Розкол `widget` на два, 31.08.2026. Один ключ називався «Віджет
  // бронювання І САЙТИ» і продавав дві різні речі однією ціною: форму
  // бронювання на власному сайті готелю і конструктор сайту-вітрини.
  //
  // Ринок їх розділяє. У Sirvoy движок бронювання входить у найдешевший
  // платний тариф, а конструктор сайту — лише в Pro. Тобто конкурент віддає
  // дешево саме прямі броні, і це його точка захоплення нашого сегмента:
  // броня без комісії OTA — найсильніший аргумент, який узагалі є, і ховати
  // його за upsell означає програвати перше враження.
  //
  // Звідси рішення власника: прямі броні ДАЄМО — вони не коштують нам нічого
  // і виграють клієнта; за доступ до чужого трафіку (`channels`) і за
  // конструктор сайту БЕРЕМО.
  //
  // Але другого ключа тут поки НЕМАЄ, і це теж навмисно. Конструктора в коді
  // не існує: під сайти є `site_listings`, `site_rate_plans`, `site_services`
  // і `site_incoming_leads` — усе це дані ПОТОКУ БРОНЮВАННЯ, і жодної
  // таблиці сторінок чи секцій. Прапорець, який нічого не стереже, —
  // перемикач-обманка в налаштуваннях: клієнт його бачить, тисне, нічого не
  // відбувається. Саме через такий випадок тут з'явився `payments.check.ts`.
  //
  // Тому `site_builder` приходить РАЗОМ зі своєю вартою — так само, як
  // `channels` приходить із модулем Channex. Порядок: docs/PLAN-CORE-REBUILD.md.
  //
  // Поки його немає, `booking_engine` покриває і форму, і віддачу сайту:
  // `widget-site` — це шлях даних движка (номери, ціни, налаштування оплати),
  // без нього форма не працює на ЖОДНОМУ типі сайту. Закрити його платним
  // ключем означало б віддати готелю движок, до якого гість не дійде.
  booking_engine: { label: 'Форма бронювання і сайти', on: ON },
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
  // Зали й заходи: погодинна оренда, розсадка, кейтеринг. Дефолт знято в OFF
  // 31.08.2026: цільовий сегмент — обʼєкти на 1–15 номерів, і для садиби на
  // пʼять кімнат це зайвий розділ меню. Кому треба — вмикає.
  //
  // Наявні готелі його НЕ втрачають: міграція дописала їм явний рядок
  // `enabled = 1` перед тим, як дефолт змінився. Саме про цей випадок
  // попереджає коментар про дві родини вище — зміна дефолту без рядків
  // забрала б розділ меню мовчки в кожного, хто вже працює.
  events: { label: 'Зали та заходи', on: OFF },
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
  /**
   * Облік: подвійний запис, P&L, cashflow, бюджети, CAPEX, банк, звіти.
   *
   * OFF, і це не одруківка. Це не частина PMS у тому сенсі, у якому нею є
   * задачі чи аркуші дня: більшість готелів веде облік у програмі свого
   * бухгалтера, а тут — повноцінна фінансова система на 78 файлів, яку новий
   * клієнт не має отримувати мовчки «бо вона є».
   *
   * Дефолт OFF при цьому НЕ означає, що наявні готелі його втратять: міграція
   * 0045 вписує явний `enabled = true` кожній організації, яка існує на день
   * появи ключа. Саме тому дефолт можна зробити чесним — рядок сильніший за
   * нього, і ніхто нічого не помічає.
   *
   * Питає `requireFinanceUser` — одна точка на весь модуль, а не обгортка на
   * кожному з ~78 експортів фасаду: новий хендлер отримує перевірку тим, що
   * проходить крізь ту саму варту, а не тим, що автор не забув її додати.
   *
   * Фактурування (`invoicing`) від цього НЕ залежить: готель може виписувати
   * фактури й не вести тут книг. Це те саме розділення, заради якого
   * `@invoicing` став окремим модулем.
   */
  accounting: { label: 'Облік і фінанси', on: OFF },
  /**
   * Канали продажу: OTA через менеджера каналів.
   *
   * OFF, і саме за це береться плата. Рішення власника, записане в коментарі
   * до `booking_engine` вище: прямі броні ДАЄМО — вони не коштують нам
   * нічого і виграють клієнта; за доступ до ЧУЖОГО трафіку беремо.
   *
   * Ключ зʼявився разом зі своєю вартою, а не наперед. Це не формальність:
   * прапорець, який нічого не стереже, — перемикач-обманка в налаштуваннях,
   * і саме через такий випадок у цій кодовій базі зʼявився
   * `payments.check.ts`. Тут варта справжня: `cron/channels-pull` не
   * опитує стрічку готелю без цього ключа, а екран облікових даних не
   * показує поля менеджера каналів (`INTEGRATION_FEATURE.channel_manager`).
   *
   * Чого ключ поки НЕ стереже — розсилки ARI: її ще немає. Зʼявиться —
   * піде крізь ту саму варту.
   */
  channels: { label: 'Канали продажу (OTA)', on: OFF },
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
