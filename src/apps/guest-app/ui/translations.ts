/**
 * Мова гостьової сторінки — З ТЕЛЕФОНА (КІ20), і словник свій.
 *
 * ── Чому не `t()` ───────────────────────────────────────────────────────
 *
 * Та сама причина, що в кіоску (КІ7): `t()` — мова ОПЕРАТОРА, а тут читає
 * гість. Інваріант 19 про це прямо.
 *
 * ── Чому з заголовка, а не з `navigator.language` ───────────────────────
 *
 * `navigator.language` доступний лише ПІСЛЯ гідратації, тобто після першого
 * малювання. На телефоні перший екран і є весь екран, тож англієць побачив би
 * спалах німецької, перш ніж сторінка передумає. Заголовок `Accept-Language`
 * приходить із першим же запитом, тож мова відома ДО того, як щось
 * намальовано.
 *
 * Вибір гостя перемагає пристрій і памʼятається (`localStorage`) — на ТЕЛЕФОНІ
 * це можна, бо наступний відвідувач там той самий чоловік. У кіоску навпаки,
 * і саме тому це різні файли, а не спільний (КІ20).
 */

export const GUEST_LANGS = ['de', 'en'] as const;
export type GuestLang = typeof GUEST_LANGS[number];

export const GUEST_LANG_LABELS: Record<GuestLang, string> = { de: 'Deutsch', en: 'English' };

export function guestLang(value: unknown): GuestLang {
  return value === 'en' ? 'en' : 'de';
}

/**
 * Мова з `Accept-Language`.
 *
 * Заголовок виглядає як `de-AT,de;q=0.9,en-US;q=0.8` — список із вагами, у
 * довільному порядку. Тому не «перший підрядок», а розбір: пари
 * «мова + вага», сортування за вагою, і перша, яку ми ВМІЄМО. Телефон
 * чеха з `cs,en;q=0.8` має дістати англійську, а не німецьку за замовчуванням:
 * чех радше прочитає англійську, ніж мову країни, у яку приїхав.
 *
 * Порожній або незрозумілий заголовок — `de`, бо це мова обʼєктів, з яких
 * застосунок починається, і мовчазного «невідомо» на екрані бути не може.
 */
export function languageFromHeader(header: unknown): GuestLang {
  if (typeof header !== 'string' || !header.trim()) return 'de';
  const wanted = header.split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((x) => x.tag && x.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  for (const { tag } of wanted) {
    // `de-AT` це теж `de`: регіон нам байдужий, словників усе одно два.
    const base = tag.split('-')[0];
    if ((GUEST_LANGS as readonly string[]).includes(base)) return base as GuestLang;
  }
  return 'de';
}

export interface GuestStrings {
  haveBooking: string;
  haveBookingHelp: string;
  noBooking: string;
  noBookingHelp: string;
  welcome: string;
  lead: string;
  soon: string;

  findTitle: string;
  findLead: string;
  phone: string;
  guestName: string;
  continue: string;
  back: string;
  searching: string;
  /** «Не знайшли» — одне речення на «не те набрано» і на «немає»: різниця між
   *  ними це спосіб промацати базу, а не допомога гостю. */
  notFound: string;
  /** Бронь є, гостьової сторінки немає — це ІНША порада, ніж «перевірте номер». */
  noPage: string;
  tooMany: string;
}

const de: GuestStrings = {
  welcome: 'Willkommen',
  lead: 'Wie können wir helfen?',
  haveBooking: 'Ich habe eine Buchung',
  haveBookingHelp: 'Einchecken und Zimmerschlüssel erhalten',
  noBooking: 'Ich brauche ein Zimmer',
  noBookingHelp: 'Verfügbarkeit ansehen und buchen',
  soon: 'Dieser Schritt wird gerade eingerichtet.',

  findTitle: 'Ihre Buchung finden',
  findLead: 'Telefonnummer und Name wie bei der Buchung.',
  phone: 'Telefonnummer',
  guestName: 'Name',
  continue: 'Weiter',
  back: 'Zurück',
  searching: 'Wird gesucht…',
  notFound: 'Wir konnten die Buchung nicht finden. Bitte prüfen Sie die Angaben oder wenden Sie sich an die Rezeption.',
  noPage: 'Ihre Buchung ist da, aber der Online-Check-in ist dafür nicht freigeschaltet. Bitte wenden Sie sich an die Rezeption.',
  tooMany: 'Zu viele Versuche. Bitte in einer Viertelstunde erneut versuchen.',
};

const en: GuestStrings = {
  welcome: 'Welcome',
  lead: 'How can we help?',
  haveBooking: 'I have a booking',
  haveBookingHelp: 'Check in and get your room key',
  noBooking: 'I need a room',
  noBookingHelp: 'See availability and book',
  soon: 'This step is still being set up.',

  findTitle: 'Find your booking',
  findLead: 'Phone number and name as in the booking.',
  phone: 'Phone number',
  guestName: 'Name',
  continue: 'Continue',
  back: 'Back',
  searching: 'Searching…',
  notFound: 'We could not find the booking. Please check the details or contact the reception.',
  noPage: 'Your booking is there, but online check-in is not enabled for it. Please contact the reception.',
  tooMany: 'Too many attempts. Please try again in fifteen minutes.',
};

export const GUEST_STRINGS: Record<GuestLang, GuestStrings> = { de, en };
