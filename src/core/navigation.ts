/**
 * Кожен екран застосунку — одним списком.
 *
 * Бічне меню показує НЕ всі екрани, і це правильно: 14 підсторінок
 * налаштувань у меню зробили б його непридатним. Але «не в меню» перетворилось
 * на «недосяжно, якщо не памʼятаєш адресу» — а половина того, що людина шукає,
 * лежить саме там: ставки ПДВ, серії фактур, ролі, типи номерів.
 *
 * Тому список екранів живе окремо від меню й повний. Меню лишається
 * кураторським (Sidebar тримає свій набір із іконками), а пошук бере звідси.
 *
 * ── Права й функції ─────────────────────────────────────────────────────
 *
 * `permission` тут — обіцянка не пропонувати перехід, який закінчиться 403.
 * Це НЕ перевірка безпеки, і називати її так було б самообманом: цей каталог
 * імпортує клієнтський `AccountMenu`, тобто він цілком лежить у бандлі
 * браузера. Справжня варта — на кожному екрані й кожному маршруті окремо.
 *
 * `feature` — ключ із `core/features.ts`. Вимкнений модуль не має
 * знаходитись: інакше «Зали» знайдуться в готелі, який залів не має.
 */
import type { Permission } from '@core/auth/permissions';

export interface Destination {
  /** Те, що бачить людина. Українською — далі через `t()`. */
  label: string;
  href: string;
  /** Розділ, у якому екран живе: показується сірим поруч із назвою. */
  section: string;
  permission: Permission;
  /** Ключ функції з core/features.ts. Немає — екран є завжди. */
  feature?: string;
  /**
   * Слова, за якими цей екран шукають, але яких немає в назві.
   *
   * Людина шукає «ПДВ», а екран зветься «Фактурування»; шукає «пароль» —
   * а екран «Користувачі та ролі». Без цього списку пошук знаходить лише
   * тих, хто вже знає назву, тобто саме тих, кому він не потрібен.
   */
  keywords?: string[];
}

export const DESTINATIONS: Destination[] = [
  // ── Основне ──────────────────────────────────────────────────────────
  { label: 'Dashboard', href: '/app/dashboard', section: 'Основне', permission: 'nav:dashboard', feature: 'dashboard', keywords: ['головна', 'огляд', 'зведення'] },
  { label: 'Планер', href: '/app/calendar', section: 'Основне', permission: 'nav:calendar', keywords: ['календар', 'шахматка', 'заселення', 'вільні номери'] },
  { label: 'Бронювання', href: '/app/bookings', section: 'Основне', permission: 'nav:bookings', keywords: ['броні', 'резервації', 'заїзди', 'виїзди'] },
  { label: 'Гості', href: '/app/guests', section: 'Основне', permission: 'nav:guests', keywords: ['клієнти', 'контакти'] },
  { label: 'Задачі', href: '/app/tasks', section: 'Основне', permission: 'nav:tasks', feature: 'tasks', keywords: ['прибирання', 'housekeeping', 'доручення'] },
  { label: 'Аркуші дня', href: '/app/day-sheets', section: 'Основне', permission: 'nav:bookings', feature: 'day_sheets', keywords: ['друк', 'зміна', 'рецепція'] },
  { label: 'Зали', href: '/app/events', section: 'Основне', permission: 'nav:bookings', feature: 'events', keywords: ['події', 'банкет', 'конференція'] },

  // ── Управління ───────────────────────────────────────────────────────
  { label: 'Ціни та наявність', href: '/app/pricing', section: 'Управління', permission: 'nav:pricing', keywords: ['ціноутворення', 'тарифи', 'ціни', 'сезони', 'календар цін'] },
  // Звіти — один вхід (Блок 1.4): сторінка-хаб без ключа; кожен звіт — за своїм.
  { label: 'Звіти', href: '/app/reports', section: 'Управління', permission: 'nav:dashboard', keywords: ['звіти', 'аналітика', 'статистика'] },
  { label: 'Аналітика продажів', href: '/app/reports/sales', section: 'Звіти', permission: 'nav:reports', feature: 'reports', keywords: ['звіти', 'статистика', 'завантаження', 'ADR', 'виручка'] },
  { label: 'Туристичний збір', href: '/app/reports/city-tax', section: 'Звіти', permission: 'nav:reports', feature: 'reports', keywords: ['курортний збір', 'громада', 'звіт'] },
  { label: 'Документи', href: '/app/documents', section: 'Управління', permission: 'nav:documents', feature: 'invoicing', keywords: ['фактури', 'інвойси', 'рахунки', 'договори'] },
  { label: 'Evidenční kniha', href: '/app/guest-registry', section: 'Управління', permission: 'nav:guests', keywords: ['книга гостей', 'реєстр', 'поліція'] },
  { label: 'Журнал змін', href: '/app/audit', section: 'Управління', permission: 'nav:settings', keywords: ['хто змінив', 'історія', 'аудит'] },

  // ── Фінанси ──────────────────────────────────────────────────────────
  { label: 'Фінанси — огляд', href: '/app/finance', section: 'Фінанси', permission: 'nav:finance', feature: 'accounting', keywords: ['баланс', 'каса', 'гроші'] },
  { label: 'Фінансові операції', href: '/app/finance/operations', section: 'Фінанси', permission: 'nav:finance', feature: 'accounting', keywords: ['витрати', 'надходження', 'платежі'] },

  // ── Інтеграції ───────────────────────────────────────────────────────
  { label: 'Канали', href: '/app/settings/channel-manager', section: 'Інтеграції', permission: 'nav:settings', keywords: ['booking.com', 'airbnb', 'ical', 'синхронізація'] },
  { label: 'Віджет бронювання', href: '/app/settings/booking-widget', section: 'Інтеграції', permission: 'nav:settings', feature: 'booking_engine', keywords: ['embed', 'код на сайт', 'форма бронювання'] },
  { label: 'Сайти бронювання', href: '/app/sites', section: 'Інтеграції', permission: 'nav:sites', feature: 'sites', keywords: ['лендінг', 'домен', 'сторінка'] },

  // ── Налаштування ─────────────────────────────────────────────────────
  { label: 'Налаштування', href: '/app/settings', section: 'Налаштування', permission: 'nav:settings' },
  { label: 'Загальні налаштування', href: '/app/settings/general', section: 'Налаштування', permission: 'nav:settings', keywords: ['валюта', 'часова зона', 'мова', 'реквізити', 'IČO', 'ПДВ-номер'] },
  { label: "Об'єкти", href: '/app/settings/properties', section: 'Налаштування', permission: 'nav:settings', keywords: ['готель', 'адреса', 'корпус'] },
  { label: 'Номери / Юніти', href: '/app/settings/units', section: 'Налаштування', permission: 'nav:settings', keywords: ['кімнати', 'типи номерів', 'будівлі', 'поверхи'] },
  { label: 'Користувачі та ролі', href: '/app/settings/users', section: 'Налаштування', permission: 'manage_users', keywords: ['персонал', 'доступи', 'права', 'пароль'] },
  { label: 'Модулі та інтеграції', href: '/app/settings/features', section: 'Налаштування', permission: 'nav:settings', keywords: ['увімкнути', 'вимкнути', 'ключі', 'API'] },
  { label: 'Фактурування', href: '/app/settings/invoicing', section: 'Налаштування', permission: 'nav:settings', feature: 'invoicing', keywords: ['ПДВ', 'ставки податку', 'серії', 'нумерація', 'фактура', 'строк оплати', 'бланк'] },
  { label: 'Оплати', href: '/app/settings/payments', section: 'Налаштування', permission: 'nav:settings', keywords: ['еквайринг', 'термінал', 'картка', 'готівка'] },
  { label: 'Ціни за заселеністю', href: '/app/settings/pricing-matrix', section: 'Налаштування', permission: 'nav:pricing', keywords: ['одномісний', 'двомісний', 'матриця', 'знижка за тривалість'] },
  { label: 'Ціни каналів', href: '/app/settings/channel-rules', section: 'Налаштування', permission: 'nav:pricing', keywords: ['націнка', 'комісія', 'сніданок у ціні'] },
  { label: 'Джерела бронювань', href: '/app/settings/booking-sources', section: 'Налаштування', permission: 'nav:settings', keywords: ['звідки прийшов гість', 'канал продажу'] },
  { label: 'Послуги', href: '/app/settings/services', section: 'Налаштування', permission: 'nav:settings', keywords: ['сауна', 'сніданок', 'трансфер', 'додаткові'] },
  { label: 'Легенда', href: '/app/settings/legend', section: 'Налаштування', permission: 'nav:settings', keywords: ['кольори', 'статуси', 'позначення', 'що означає'] },
  { label: 'Гостьова сторінка', href: '/app/settings/guest-page', section: 'Налаштування', permission: 'nav:settings', feature: 'guest_page', keywords: ['портал гостя', 'самореєстрація', 'wifi'] },
];

/**
 * Екрани, які цей користувач має право бачити.
 *
 * Обидва фільтри обовʼязкові й обидва на сервері. Права — щоб назва екрана не
 * витекла тому, кому він недоступний; функції — щоб вимкнений модуль не
 * знаходився.
 */
export function visibleDestinations(
  permissions: string[],
  features: Record<string, boolean>,
  hasPermissionFn: (perms: string[], p: Permission) => boolean,
): Destination[] {
  return DESTINATIONS.filter((d) => {
    if (!hasPermissionFn(permissions, d.permission)) return false;
    if (d.feature && !features[d.feature]) return false;
    return true;
  });
}

/**
 * Якому екрану каталогу належить ця адреса.
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * Ключ модуля перевіряли дві речі: меню (ховало пункт) і маршрути API
 * (`withModule` відмовляв 403). Самі СТОРІНКИ не перевіряв ніхто, тож готель,
 * який вимкнув «Задачі персоналу», відкривав `/app/tasks` із закладки, з
 * історії або з адресного рядка й бачив нормальний екран розділу. Даних на
 * ньому не було — API чесно відмовляв, — але людині це виглядало як «розділ
 * є, просто порожній». Заслінка `ModuleGate` питає звідси.
 *
 * ── Найдовший префікс ───────────────────────────────────────────────────
 *
 * `/app/finance/operations` має свій рядок, `/app/finance/reports` — ні, але
 * належить тому самому ключу `accounting`; точний збіг ловив би лише перший.
 * Найдовший береться серед УСІХ рядків, а не лише серед тих, що мають ключ:
 * `/app/settings` ключа не має, `/app/settings/invoicing` має `invoicing`, і
 * навпаки теж буває. Найточніший опис екрана — той, що каже про нього
 * найбільше; інакше вкладений екран без ключа успадкував би ключ батька.
 */
export function destinationForPath(pathname: string): Destination | undefined {
  let best: Destination | undefined;
  for (const d of DESTINATIONS) {
    if (pathname !== d.href && !pathname.startsWith(`${d.href}/`)) continue;
    if (!best || d.href.length > best.href.length) best = d;
  }
  return best;
}

/** Чи згадує цей екран те, що шукають. Назва, розділ або ключове слово. */
export function destinationMatches(d: Destination, needle: string): boolean {
  const n = needle.toLowerCase();
  if (d.label.toLowerCase().includes(n)) return true;
  if (d.section.toLowerCase().includes(n)) return true;
  return (d.keywords ?? []).some((k) => k.toLowerCase().includes(n));
}
