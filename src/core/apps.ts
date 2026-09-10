/**
 * Реєстр застосунків — одне джерело правди для екрана «Застосунки».
 *
 * ── Що таке застосунок ───────────────────────────────────────────────────
 *
 * Три рівні (Блок «Застосунки», 09.09.2026, docs/tasks/2026-09-09-block-apps.md):
 *
 *   ядро     — є в кожного (`kind: 'core'` у реєстрі фіч);
 *   модуль   — розділ PMS зі своїми екранами (`kind: 'module'`), вмикається на
 *              екрані «Модулі»;
 *   застосунок — розмова з ЧУЖОЮ системою: ключі вендора, стан звʼязку,
 *              своя ціна (З1). Картка на екрані «Застосунки», розділу в меню
 *              не має. Вимикач — той самий ключ реєстру фіч (`feature`), якщо
 *              він у застосунку є.
 *
 * Менеджер каналів — НЕ застосунок (З4): це модуль `channels`, через нього
 * піде листування і підключатиметься більшість готелів. Його ключ
 * (`channel_manager`) лишається в `integration-credentials.ts` поіменно, а
 * стан звʼязку читається з `cm_connections` і показується в тому самому списку
 * здоровʼя як «менеджер каналів» (`app-connections.ts`, `channelManagerHealth`).
 *
 * ── Форма запису — дані, не код ──────────────────────────────────────────
 *
 * Кожен запис читається як МАНІФЕСТ: те, що колись прийде з теки застосунку,
 * коли застосунки стануть відкритим кодом (З1). Тому тут немає функцій із
 * поведінкою вендора — лише що це, чим вмикається, які ключі просить, скільки
 * коштує і чи існує код, який із вендором говорить (`live`).
 *
 * `live` — те саме слово, що `PAYMENT_PROVIDERS.live` у `payments.ts`, і з тим
 * самим значенням: код, який говорить із вендором, ІСНУЄ. Не live = «скоро»:
 * картка з бейджем і кнопкою «хочу», без вимикача і без полів ключів (П5 —
 * прапорець без варти це перемикач-обманка). Ключ `FEATURE_SPEC` для
 * «скоро»-застосунків не заводиться; він прийде разом із кодом і вартою.
 *
 * ── Платіжні шлюзи: чому тут без label/where/live ────────────────────────
 *
 * `payments.ts` імпортує `integration-credentials.ts`, а та — цей файл. Тому
 * імпорт `payments.ts` звідси — цикл, і він заборонений. Шлюз тут — запис із
 * тим, чого `payments.ts` не знає (поля ключів, ціна, вимикач), а `label`,
 * `where` і `live` беруться з `PAYMENT_PROVIDERS` у місці читання —
 * `appCatalog(PAYMENT_PROVIDERS)` віддає той самий обʼєкт за посиланням.
 * Гейт `apps.check.ts` доводить, що це посилання, а не копія, — так само, як
 * `payments.check.ts` тримає юніон каналів чесним замість імпорту.
 *
 * ── Закон: креденшели — організації, підключення — обʼєкту ───────────────
 *
 * Ключі лежать в `channel_credentials` на організації. А от ПІДКЛЮЧЕНИЙ
 * застосунок може бути на обʼєкті: TSE стоїть на конкретному готелі
 * (`fin_fiscal_settings.property_id`), а пошта — одна на організацію.
 * `scope` каже, до чого чіпляється стан звʼязку; `app-connections.ts` це
 * перевіряє і рядок із порушенням закону не пише.
 */
import type { FeatureKey } from './features.ts';

export type AppId =
  | 'fiskaly'
  | 'stripe'
  | 'paypal'
  | 'teya'
  | 'smtp'
  | 'winhotel_import'
  | 'dirs21'
  | 'pricelabs'
  | 'unzer';

export type AppKind =
  | 'fiscal'
  | 'payment'
  | 'mail'
  | 'import'
  | 'channel'
  | 'pricing'
  | 'device'
  | 'accounting';

/** З1: застосунок буває безкоштовний, платний або в складі модуля. */
export type AppPricing = 'free' | 'paid' | 'included';

/** До чого чіпляється стан звʼязку: до організації чи до одного обʼєкта. */
export type AppScope = 'organization' | 'property';

export interface AppField {
  field: 'accessToken' | 'clientId' | 'clientSecret';
  label: string;
  hint?: string;
}

interface ManifestBase {
  id: AppId;
  kind: AppKind;
  /** Вимикач у реєстрі фіч. `null` — без вимикача (smtp) АБО «скоро». */
  feature: FeatureKey | null;
  /** Поля ключів — те, що досі стояло в `INTEGRATION_FIELDS`. Порожньо для «скоро». */
  fields: AppField[];
  pricing: AppPricing;
  scope: AppScope;
}

/** Застосунок, який описує себе сам. */
export interface OwnAppManifest extends ManifestBase {
  label: string;
  /** Де готель бере свої ключі. Порожньо для «скоро». */
  where: string;
  /** Код, що говорить із вендором, ІСНУЄ. Зразок — `PAYMENT_PROVIDERS.live`. */
  live: boolean;
}

/**
 * Платіжний шлюз: label, where і live — у `PAYMENT_PROVIDERS` (`payments.ts`),
 * і лише там. Див. шапку файлу.
 */
export interface GatewayAppManifest extends ManifestBase {
  kind: 'payment';
  /** Ознака: опис шлюзу живе в PAYMENT_PROVIDERS. */
  gateway: true;
}

export type AppManifest = OwnAppManifest | GatewayAppManifest;

export const APPS: readonly AppManifest[] = [
  {
    id: 'fiskaly',
    kind: 'fiscal',
    label: 'fiskaly SIGN DE (TSE)',
    feature: 'fiscal_de',
    // TSE (KassenSichV). Який TSS і який зареєстрований касовий клієнт
    // використовує ОБʼЄКТ — ідентифікатори, не секрети; вони в fin_fiscal_settings.
    fields: [
      { field: 'clientId', label: 'API key', hint: 'fiskaly dashboard → SIGN DE' },
      { field: 'clientSecret', label: 'API secret' },
    ],
    where: 'fiskaly dashboard → SIGN DE → API keys',
    live: true,
    pricing: 'included',
    scope: 'property',
  },
  // Три шлюзи: поля з колишнього INTEGRATION_FIELDS; label/where/live — з
  // PAYMENT_PROVIDERS у appCatalog(). Один вимикач на всіх: «онлайн-оплата» —
  // модуль, а який провайдер її обслуговує — вибір готелю, не окрема покупка.
  {
    id: 'stripe',
    kind: 'payment',
    gateway: true,
    feature: 'online_payments',
    fields: [
      { field: 'clientId', label: 'Publishable key', hint: 'pk_live_… — Stripe Dashboard → Developers → API keys' },
      { field: 'clientSecret', label: 'Secret key', hint: 'sk_live_…' },
    ],
    pricing: 'included',
    scope: 'organization',
  },
  {
    id: 'paypal',
    kind: 'payment',
    gateway: true,
    feature: 'online_payments',
    fields: [
      { field: 'clientId', label: 'Client ID', hint: 'PayPal Developer → Apps & Credentials' },
      { field: 'clientSecret', label: 'Secret' },
    ],
    pricing: 'included',
    scope: 'organization',
  },
  {
    id: 'teya',
    kind: 'payment',
    gateway: true,
    feature: 'online_payments',
    fields: [
      { field: 'clientId', label: 'Client ID', hint: 'Teya Portal → API' },
      { field: 'clientSecret', label: 'Client secret' },
    ],
    pricing: 'included',
    scope: 'organization',
  },
  {
    id: 'smtp',
    kind: 'mail',
    label: 'Пошта готелю (SMTP)',
    // Вимикача немає, і не має бути: лист із підтвердженням броні не купують
    // окремо. Питання лише в тому, ЧИЄЮ адресою він іде (ARCHITECTURE §2.3).
    feature: null,
    // Три поля, а не пʼять: порт 587 зі STARTTLS, адреса відправника = логін.
    // Порт і окрема адреса — наступне поле й наступна міграція, коли зʼявиться
    // готель, якому цього замало.
    fields: [
      { field: 'clientId', label: 'SMTP-сервер', hint: 'напр. smtp.gmail.com · порт 587, STARTTLS' },
      { field: 'accessToken', label: 'Логін', hint: 'він же адреса відправника' },
      { field: 'clientSecret', label: 'Пароль' },
    ],
    where: 'Налаштування поштової скриньки готелю → SMTP',
    live: true,
    pricing: 'free',
    scope: 'organization',
  },
  // Перший застосунок рівня 3 (З1: безкоштовний), live з 10.09.2026
  // (docs/tasks/2026-09-10-block-winhotel-import.md). Полів ключів НЕМАЄ
  // навмисно: ключ тут не вставляють, а ГЕНЕРУЮТЬ — токен агента робиться на
  // картці, показується раз, і в `channel_credentials` лягає лише його хеш
  // (`src/apps/winhotel-import/data/agent-token.ts`). Поле з формою «вставте
  // ключ» зберігало б сам токен — тобто те, чого в базі не має бути.
  {
    id: 'winhotel_import',
    kind: 'import',
    label: 'Імпорт із Winhotel',
    feature: 'winhotel_import',
    fields: [],
    where: 'Токен агента — кнопка на цій картці; агент — apps/winhotel-agent/ (README.de.md)',
    live: true,
    pricing: 'free',
    scope: 'organization',
  },
  // ── «Скоро»: картка і кнопка «хочу», без коду ──────────────────────────
  // Порядок за З4: dirs21 → fiskaly (той уже live).
  {
    // Адаптер буде — окремим застосунком після Schnittstellenvertrag з
    // TourOnline (уточнення власника 09.09). Публічної документації немає.
    id: 'dirs21',
    kind: 'channel',
    label: 'DIRS21',
    feature: null,
    fields: [],
    where: '',
    live: false,
    pricing: 'paid',
    scope: 'property',
  },
  {
    id: 'pricelabs',
    kind: 'pricing',
    label: 'PriceLabs',
    feature: null,
    fields: [],
    where: '',
    live: false,
    pricing: 'paid',
    scope: 'property',
  },
  {
    // Шлюз, якого в PAYMENT_PROVIDERS ще немає: коли зʼявиться код, він стане
    // рядком там, а тут — записом із `gateway: true`, як три інші.
    id: 'unzer',
    kind: 'payment',
    label: 'Unzer',
    feature: null,
    fields: [],
    where: '',
    live: false,
    pricing: 'paid',
    scope: 'organization',
  },
];

/** Шлюз, чий опис живе в PAYMENT_PROVIDERS. */
export function isGatewayApp(app: AppManifest): app is GatewayAppManifest {
  return 'gateway' in app && app.gateway === true;
}

export function appById(id: string): AppManifest | undefined {
  return APPS.find((a) => a.id === id);
}

export function isAppId(id: string): id is AppId {
  return APPS.some((a) => a.id === id);
}

/** Стан застосунку на картці. `soon` — коду немає; решта — зі стану звʼязку. */
export type AppStatus = 'soon' | 'disabled' | 'unknown' | 'connected' | 'degraded' | 'error';

/**
 * Обовʼязково те саме, що `PaymentProvider` у payments.ts — але оголошене
 * тут структурно, щоб цей файл не імпортував payments.ts (цикл).
 */
export interface GatewayLike {
  id: string;
  label: string;
  where: string;
  live: boolean;
}

export interface AppEntry {
  id: AppId;
  kind: AppKind;
  label: string;
  feature: FeatureKey | null;
  fields: AppField[];
  where: string;
  live: boolean;
  pricing: AppPricing;
  scope: AppScope;
  /** Без стану звʼязку — лише `soon` або `unknown`; стан підставляє читач. */
  status: AppStatus;
  /** Для шлюзу — той самий обʼєкт із PAYMENT_PROVIDERS, за посиланням. */
  provider?: GatewayLike;
}

/**
 * Каталог із підставленими шлюзами.
 *
 * `providers` — це `PAYMENT_PROVIDERS`; передається аргументом саме тому, що
 * імпортувати його звідси не можна. Шлюз, якого в `providers` немає, у каталог
 * не потрапляє: картка без label і без відповіді «чи live» — це картка-обманка.
 */
export function appCatalog(providers: readonly GatewayLike[]): AppEntry[] {
  const out: AppEntry[] = [];
  for (const app of APPS) {
    if (isGatewayApp(app)) {
      const provider = providers.find((p) => p.id === app.id);
      if (!provider) continue;
      out.push({
        ...app,
        label: provider.label,
        where: provider.where,
        live: provider.live,
        status: provider.live ? 'unknown' : 'soon',
        provider,
      });
      continue;
    }
    out.push({ ...app, status: app.live ? 'unknown' : 'soon' });
  }
  return out;
}
