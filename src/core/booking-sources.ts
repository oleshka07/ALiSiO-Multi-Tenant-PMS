/**
 * Канали, з яких приходить бронь, у нового готелю.
 *
 * ── Чому цей файл є ─────────────────────────────────────────────────────
 *
 * `booking_sources` наповнювалась в одному місці: у SQLite-міграції, яка
 * створює таблицю, і рівно для `properties LIMIT 1` — першого обʼєкта, який
 * трапиться в базі. Тобто список отримував demo-seed, а КОЖЕН реальний
 * готель, заведений після цього, стартував із порожньою таблицею. На
 * Postgres та міграція не виконується взагалі.
 *
 * Наслідок видно на першому ж екрані: бронь без відомого джерела малюється
 * сірим бейджем «direct», однаковим для прямого гостя, дзвінка й пошти. Звіт
 * «звідки приходять гості» при цьому показує одну колонку.
 *
 * ── Чому саме ці чотири ─────────────────────────────────────────────────
 *
 * Тут лише канали, які має будь-який готель незалежно від того, як він
 * продає: прямо, телефон, пошта, з вулиці. Booking.com, Airbnb і решта OTA
 * СВІДОМО відсутні — на яких майданчиках готель продає, це його бізнес-факт,
 * і він називає їх у власному файлі (секція `bookingSources`). Засіяти їх за
 * замовчуванням означало б написати за готель, що він там продає, і покласти
 * в звіт канал, якого в нього немає. Та сама помилка, що з «безкоштовною
 * парковкою»: система стверджує щось про готель замість готелю.
 *
 * Назви — мовою готелю, бо це його дані, а не інтерфейс: німецькому готелю
 * список каналів українською не допомагає жодного дня.
 */

/** Один канал у списку за замовчуванням. `code` стабільний, назва — ні. */
export interface DefaultBookingSource {
  code: string;
  iconLetter: string;
  color: string;
  sortOrder: number;
  /** Назва по мовах. Мова готелю → його ж список. */
  name: Record<string, string>;
}

export const DEFAULT_BOOKING_SOURCES: readonly DefaultBookingSource[] = [
  {
    code: 'direct', iconLetter: 'D', color: '#22c55e', sortOrder: 1,
    name: {
      uk: 'Прямо', en: 'Direct', de: 'Direkt', cs: 'Přímo',
      pl: 'Bezpośrednio', nl: 'Direct', fr: 'Direct',
    },
  },
  {
    code: 'phone', iconLetter: 'T', color: '#3b82f6', sortOrder: 2,
    name: {
      uk: 'Телефон', en: 'Phone', de: 'Telefon', cs: 'Telefon',
      pl: 'Telefon', nl: 'Telefoon', fr: 'Téléphone',
    },
  },
  {
    code: 'email', iconLetter: 'E', color: '#8b5cf6', sortOrder: 3,
    name: {
      uk: 'Пошта', en: 'Email', de: 'E-Mail', cs: 'E-mail',
      pl: 'E-mail', nl: 'E-mail', fr: 'E-mail',
    },
  },
  {
    code: 'walk_in', iconLetter: 'W', color: '#f59e0b', sortOrder: 4,
    name: {
      uk: 'З вулиці', en: 'Walk-in', de: 'Laufkundschaft', cs: 'Bez rezervace',
      pl: 'Z ulicy', nl: 'Walk-in', fr: 'Sans réservation',
    },
  },
];

/**
 * Список для готелю, який говорить цією мовою.
 *
 * Мова поза списком падає в англійську, а не в українську: англійську
 * прочитає більше персоналу, ніж мову автора продукту.
 */
export function defaultBookingSources(language: string): Array<{
  code: string; name: string; iconLetter: string; color: string; sortOrder: number;
}> {
  return DEFAULT_BOOKING_SOURCES.map((s) => ({
    code: s.code,
    name: s.name[language] ?? s.name.en,
    iconLetter: s.iconLetter,
    color: s.color,
    sortOrder: s.sortOrder,
  }));
}
