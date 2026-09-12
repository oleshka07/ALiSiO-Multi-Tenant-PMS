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

  // ── Крок «немає бронювання»: дати → номери з цінами → контакти → готово ──
  stayTitle: string;
  arrival: string;
  departure: string;
  guests: string;
  search: string;
  searchingRooms: string;
  /** Жодної пари «номер × тариф» на ці дати — і це не помилка гостя. */
  nothingFree: string;
  /** Готель веде книгу в іншій системі: бронювання — на його власній сторінці. */
  handoff: string;
  handoffOpen: string;
  perNight: string;
  nightsOne: string;
  nightsMany: string;
  freeLeft: string;
  totalLabel: string;
  breakfast: string;
  choose: string;
  yourDetails: string;
  firstName: string;
  lastName: string;
  email: string;
  emailHelp: string;
  bookNow: string;
  booking: string;
  /**
   * Тримаємо номер стільки-то хвилин — сказати вголос, бо строк справжній.
   * `{minutes}` підставляє екран із `HOLD_MINUTES`: число в тексті, написане
   * окремо від числа в коді, розійдеться з ним при першій же зміні строку, і
   * гість читатиме на екрані одне, а бронь житиме інше.
   */
  heldFor: string;
  confirmTitle: string;
  confirmLead: string;
  confirm: string;
  confirming: string;
  /** Строк минув: номер уже звільнено, і починати треба спочатку. */
  holdExpired: string;
  /** Кімнату щойно забрали — інша порада, ніж «нічого немає на ці дати». */
  roomTaken: string;
  /** Щось у полях не так: імʼя, телефон, дати. */
  checkDetails: string;
  payAtReception: string;
  bookingFailed: string;

  // ── Готель, чию книгу веде своя система: передача і заявка (КІ8) ────────
  /** «Я щойно забронював у вас на сторінці» — кнопка після повернення. */
  justBooked: string;
  claimTitle: string;
  claimLead: string;
  confirmationNo: string;
  confirmationHelp: string;
  claimSubmit: string;
  claiming: string;
  /** Номер підтвердження не названо — без нього бронь не звʼязати з готельною. */
  needConfirmation: string;
  needLastName: string;
  needCheckIn: string;
  /** Дата заїзду поза вікном: ця сторінка про сьогодні-завтра, не про липень. */
  checkInOutOfWindow: string;
}

const de: GuestStrings = {
  welcome: 'Willkommen',
  lead: 'Wie können wir helfen?',
  haveBooking: 'Ich habe eine Buchung',
  haveBookingHelp: 'Einchecken und Zimmerschlüssel erhalten',
  noBooking: 'Ich brauche ein Zimmer',
  noBookingHelp: 'Verfügbarkeit ansehen und buchen',

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

  stayTitle: 'Zimmer finden',
  arrival: 'Anreise',
  departure: 'Abreise',
  guests: 'Erwachsene',
  search: 'Suchen',
  searchingRooms: 'Wird gesucht…',
  nothingFree: 'Für diese Daten haben wir leider nichts frei. Bitte andere Daten wählen oder die Rezeption anrufen.',
  handoff: 'Dieses Haus nimmt Buchungen auf seiner eigenen Seite entgegen.',
  handoffOpen: 'Zur Buchungsseite',
  perNight: 'pro Nacht',
  nightsOne: 'Nacht',
  nightsMany: 'Nächte',
  freeLeft: 'noch frei',
  totalLabel: 'Gesamtpreis',
  breakfast: 'Frühstück inklusive',
  choose: 'Auswählen',
  yourDetails: 'Ihre Daten',
  firstName: 'Vorname',
  lastName: 'Nachname',
  email: 'E-Mail (optional)',
  emailHelp: 'Für die Bestätigung. Ohne E-Mail bestätigen wir an der Rezeption.',
  bookNow: 'Zimmer reservieren',
  booking: 'Wird reserviert…',
  heldFor: 'Wir halten das Zimmer {minutes} Minuten für Sie.',
  confirmTitle: 'Fast geschafft',
  confirmLead: 'Bitte bestätigen Sie die Buchung. Danach können Sie sofort einchecken.',
  confirm: 'Buchung bestätigen',
  confirming: 'Wird bestätigt…',
  holdExpired: 'Die Zeit ist abgelaufen und das Zimmer ist wieder frei. Bitte suchen Sie erneut.',
  roomTaken: 'Dieses Zimmer wurde gerade vergeben. Bitte wählen Sie ein anderes oder andere Daten.',
  checkDetails: 'Bitte prüfen Sie Ihre Angaben.',
  payAtReception: 'Bezahlt wird an der Rezeption — bei der Anreise oder bei der Abreise.',
  bookingFailed: 'Die Buchung hat nicht geklappt. Bitte erneut versuchen oder die Rezeption anrufen.',

  justBooked: 'Ich habe gerade gebucht',
  claimTitle: 'Ihre Buchung bestätigen',
  claimLead: 'Bitte geben Sie Ihren Namen und die Buchungsnummer aus der Bestätigung ein.',
  confirmationNo: 'Buchungsnummer',
  confirmationHelp: 'Aus der Bestätigung des Hotels.',
  claimSubmit: 'Weiter zum Check-in',
  claiming: 'Wird geprüft…',
  needConfirmation: 'Bitte geben Sie die Buchungsnummer ein.',
  needLastName: 'Bitte geben Sie Ihren Nachnamen ein.',
  needCheckIn: 'Bitte geben Sie das Anreisedatum ein.',
  checkInOutOfWindow: 'Diese Seite ist für die Anreise heute oder morgen. Bitte wenden Sie sich an die Rezeption.',
};

const en: GuestStrings = {
  welcome: 'Welcome',
  lead: 'How can we help?',
  haveBooking: 'I have a booking',
  haveBookingHelp: 'Check in and get your room key',
  noBooking: 'I need a room',
  noBookingHelp: 'See availability and book',

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

  stayTitle: 'Find a room',
  arrival: 'Arrival',
  departure: 'Departure',
  guests: 'Adults',
  search: 'Search',
  searchingRooms: 'Searching…',
  nothingFree: 'We have nothing free for these dates. Please try other dates or call the reception.',
  handoff: 'This house takes bookings on its own page.',
  handoffOpen: 'Go to the booking page',
  perNight: 'per night',
  nightsOne: 'night',
  nightsMany: 'nights',
  freeLeft: 'left',
  totalLabel: 'Total price',
  breakfast: 'Breakfast included',
  choose: 'Choose',
  yourDetails: 'Your details',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'E-mail (optional)',
  emailHelp: 'For the confirmation. Without an e-mail we confirm at the reception.',
  bookNow: 'Reserve the room',
  booking: 'Reserving…',
  heldFor: 'We hold the room for you for {minutes} minutes.',
  confirmTitle: 'Almost done',
  confirmLead: 'Please confirm the booking. You can check in straight afterwards.',
  confirm: 'Confirm booking',
  confirming: 'Confirming…',
  holdExpired: 'The time ran out and the room is free again. Please search once more.',
  roomTaken: 'That room has just been taken. Please choose another one or other dates.',
  checkDetails: 'Please check your details.',
  payAtReception: 'Payment is at the reception — on arrival or on departure.',
  bookingFailed: 'The booking did not go through. Please try again or call the reception.',

  justBooked: 'I have just booked',
  claimTitle: 'Confirm your booking',
  claimLead: 'Please enter your name and the booking number from the confirmation.',
  confirmationNo: 'Booking number',
  confirmationHelp: 'From the hotel’s confirmation.',
  claimSubmit: 'Continue to check-in',
  claiming: 'Checking…',
  needConfirmation: 'Please enter the booking number.',
  needLastName: 'Please enter your surname.',
  needCheckIn: 'Please enter the arrival date.',
  checkInOutOfWindow: 'This page is for arrivals today or tomorrow. Please contact the reception.',
};

export const GUEST_STRINGS: Record<GuestLang, GuestStrings> = { de, en };
