/**
 * Мова гостьового застосунку — З ТЕЛЕФОНА (КІ20), і словник свій.
 *
 * ── Чому не `t()` ───────────────────────────────────────────────────────
 *
 * Та сама причина, що в кіоску (КІ7): `t()` — мова ОПЕРАТОРА, а тут читає
 * гість. Інваріант 19 про це прямо.
 *
 * ── Чому з заголовка, а не з `navigator.language` ───────────────────────
 *
 * `navigator.language` доступний лише ПІСЛЯ гідратації, тобто після першого
 * малювання. На телефоні перший екран і є весь екран, тож француз побачив би
 * спалах німецької, перш ніж сторінка передумає. Заголовок `Accept-Language`
 * приходить із першим же запитом, тож мова відома ДО того, як щось
 * намальовано.
 *
 * Вибір гостя перемагає пристрій і памʼятається (`localStorage`) — на ТЕЛЕФОНІ
 * це можна, бо наступний відвідувач там той самий чоловік. У кіоску навпаки,
 * і саме тому це різні файли, а не спільний (КІ20).
 *
 * ── Перелік мов НЕ свій: він із реєстру ─────────────────────────────────
 *
 * Тут стояло `['de', 'en']` — власний список, і це була рівно та помилка,
 * заради якої існує `core/i18n/languages.ts`. Його шапка перелічує чотири
 * попередні такі списки («гостьовий портал знав сім мов, віджет чотири…»);
 * застосунок і кіоск стали пʼятим і шостим. Наслідок видно не в коді:
 * гість із чеським телефоном відкривав німецький екран, бо його мови в
 * списку не було, хоч сусідня гостьова сторінка нею говорила.
 *
 * Тому `GUEST_LANGS` = `LANGUAGE_CODES`, а підписи — рідні назви з того ж
 * реєстру. Нова мова продукту стає однією правкою, а не пошуком шести
 * списків; що словник справді має ВСІ мови реєстру, стереже
 * `guest-languages.check`.
 */
import {
  LANGUAGE_CODES, LANGUAGES, fromAcceptLanguage, isLanguage, type Language,
} from '@core/i18n/languages';

/** Мови, якими говорить застосунок, — рівно ті, які знає продукт. */
export const GUEST_LANGS = LANGUAGE_CODES;
export type GuestLang = Language;

/**
 * Підпис у перемикачі — РІДНОЮ мовою кожної.
 *
 * Не «DE/EN/CZ»: гість, який шукає свою мову в списку, шукає слово, яке
 * впізнає. Двобуквений код упізнає той, хто вже знає, що шукати.
 */
export const GUEST_LANG_LABELS: Record<GuestLang, string> = Object.fromEntries(
  LANGUAGE_CODES.map((code) => [code, LANGUAGES[code].native]),
) as Record<GuestLang, string>;

/**
 * Слово звідки завгодно (localStorage, адресний рядок) — до відомої мови.
 *
 * `fallback` називає ВИКЛИКАЧ, і це не дрібниця: розумного дефолту в цієї
 * функції немає. Мова, з якою лишається гість, чий телефон нам нічого не
 * сказав, — це мова ГОТЕЛЮ, а її знає лише той, хто прочитав обʼєкт.
 */
export function guestLang(value: unknown, fallback: GuestLang): GuestLang {
  return isLanguage(value) ? value : fallback;
}

/**
 * Мова з `Accept-Language`.
 *
 * Розбір не свій — `fromAcceptLanguage` із реєстру. Він робив рівно те саме
 * (пари «мова + вага», сортування, перша відома), і друга копія того самого
 * алгоритму розійшлася б із першою рівно тоді, коли зміниться перша.
 *
 * `fallback` — мова готелю. Порожній або незрозумілий заголовок більше не дає
 * німецьку константою: обʼєкт у Чехії відкривався б німецькою через літерал у
 * коді, а не через чийсь вибір (інваріант 20).
 */
export function languageFromHeader(header: unknown, fallback: GuestLang): GuestLang {
  return fromAcceptLanguage(typeof header === 'string' ? header : null, fallback);
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

  // ── Крок послуг ────────────────────────────────────────────────────────
  extrasTitle: string;
  extrasLead: string;
  /** Нічого не додавати — крок пропускається, і це нормальний вибір. */
  extrasSkip: string;
  extrasNext: string;
  roomLabel: string;
  extrasLabel: string;
  grandTotal: string;
  add: string;
  remove: string;
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

  extrasTitle: 'Noch etwas dazu?',
  extrasLead: 'Alles optional — Sie können auch direkt weiter.',
  extrasSkip: 'Ohne Extras weiter',
  extrasNext: 'Weiter',
  roomLabel: 'Zimmer',
  extrasLabel: 'Extras',
  grandTotal: 'Gesamt',
  add: 'Hinzufügen',
  remove: 'Entfernen',
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

  extrasTitle: 'Anything else?',
  extrasLead: 'All optional — you can go straight on.',
  extrasSkip: 'Continue without extras',
  extrasNext: 'Continue',
  roomLabel: 'Room',
  extrasLabel: 'Extras',
  grandTotal: 'Total',
  add: 'Add',
  remove: 'Remove',
};

const cs: GuestStrings = {
  haveBooking: 'Mám rezervaci',
  haveBookingHelp: 'Odbavení a klíč od pokoje',
  noBooking: 'Potřebuji pokoj',
  noBookingHelp: 'Zobrazit volné pokoje a rezervovat',
  welcome: 'Vítejte',
  lead: 'Jak vám můžeme pomoci?',
  findTitle: 'Najít vaši rezervaci',
  findLead: 'Telefon a jméno jako v rezervaci.',
  phone: 'Telefonní číslo',
  guestName: 'Jméno a příjmení',
  continue: 'Pokračovat',
  back: 'Zpět',
  searching: 'Hledáme…',
  notFound: 'Rezervaci se nám nepodařilo najít. Zkontrolujte prosím údaje nebo se obraťte na recepci.',
  noPage: 'Vaše rezervace existuje, ale online odbavení pro ni není zapnuté. Obraťte se prosím na recepci.',
  tooMany: 'Příliš mnoho pokusů. Zkuste to prosím znovu za čtvrt hodiny.',
  stayTitle: 'Najít pokoj',
  arrival: 'Příjezd',
  departure: 'Odjezd',
  guests: 'Dospělí',
  search: 'Hledat',
  searchingRooms: 'Hledáme volné pokoje…',
  nothingFree: 'Na tyto termíny bohužel nic volného nemáme. Zvolte prosím jiné termíny nebo zavolejte na recepci.',
  handoff: 'Tento dům přijímá rezervace na vlastní stránce.',
  handoffOpen: 'Přejít na rezervační stránku',
  perNight: 'za noc',
  nightsOne: 'noc',
  nightsMany: 'nocí',
  freeLeft: 'ještě volných',
  totalLabel: 'Celková cena',
  breakfast: 'Snídaně v ceně',
  choose: 'Vybrat',
  yourDetails: 'Vaše údaje',
  firstName: 'Jméno',
  lastName: 'Příjmení',
  email: 'E-mail (nepovinné)',
  emailHelp: 'Pro potvrzení. Bez e-mailu potvrdíme na recepci.',
  bookNow: 'Rezervovat pokoj',
  booking: 'Rezervujeme…',
  heldFor: 'Pokoj vám držíme {minutes} minut.',
  confirmTitle: 'Už jen krok',
  confirmLead: 'Potvrďte prosím rezervaci. Hned poté se můžete odbavit.',
  confirm: 'Potvrdit rezervaci',
  confirming: 'Potvrzujeme…',
  holdExpired: 'Čas vypršel a pokoj je znovu volný. Zkuste prosím hledat znovu.',
  roomTaken: 'Tento pokoj byl právě obsazen. Vyberte prosím jiný nebo jiné termíny.',
  checkDetails: 'Zkontrolujte prosím zadané údaje.',
  payAtReception: 'Platí se na recepci — při příjezdu nebo při odjezdu.',
  bookingFailed: 'Rezervace neproběhla. Zkuste to prosím znovu nebo zavolejte na recepci.',
  justBooked: 'Právě jsem rezervoval',
  claimTitle: 'Potvrdit vaši rezervaci',
  claimLead: 'Zadejte prosím své příjmení a číslo rezervace z potvrzení.',
  confirmationNo: 'Číslo rezervace',
  confirmationHelp: 'Z potvrzení od hotelu.',
  claimSubmit: 'Pokračovat k odbavení',
  claiming: 'Ověřujeme…',
  needConfirmation: 'Zadejte prosím číslo rezervace.',
  needLastName: 'Zadejte prosím své příjmení.',
  needCheckIn: 'Zadejte prosím datum příjezdu.',
  checkInOutOfWindow: 'Tato stránka je pro příjezd dnes nebo zítra. Obraťte se prosím na recepci.',
  extrasTitle: 'Ještě něco?',
  extrasLead: 'Vše nepovinné — můžete pokračovat rovnou.',
  extrasSkip: 'Pokračovat bez doplňků',
  extrasNext: 'Dále',
  roomLabel: 'Pokoj',
  extrasLabel: 'Doplňky',
  grandTotal: 'Celkem',
  add: 'Přidat',
  remove: 'Odebrat',
};

const uk: GuestStrings = {
  haveBooking: 'У мене є бронювання',
  haveBookingHelp: 'Заселення і ключ від номера',
  noBooking: 'Мені потрібен номер',
  noBookingHelp: 'Подивитися вільні номери і забронювати',
  welcome: 'Вітаємо',
  lead: 'Чим можемо допомогти?',
  findTitle: 'Знайти ваше бронювання',
  findLead: 'Телефон та імʼя — як у бронюванні.',
  phone: 'Номер телефону',
  guestName: 'Імʼя та прізвище',
  continue: 'Далі',
  back: 'Назад',
  searching: 'Шукаємо…',
  notFound: 'Не вдалося знайти бронювання. Перевірте дані або зверніться на рецепцію.',
  noPage: 'Бронювання є, але онлайн-заселення для нього не ввімкнене. Зверніться, будь ласка, на рецепцію.',
  tooMany: 'Забагато спроб. Спробуйте ще раз за чверть години.',
  stayTitle: 'Знайти номер',
  arrival: 'Заїзд',
  departure: 'Виїзд',
  guests: 'Дорослі',
  search: 'Шукати',
  searchingRooms: 'Шукаємо вільні номери…',
  nothingFree: 'На ці дати вільного немає. Оберіть інші дати або зателефонуйте на рецепцію.',
  handoff: 'Цей заклад приймає бронювання на власній сторінці.',
  handoffOpen: 'Перейти на сторінку бронювання',
  perNight: 'за ніч',
  nightsOne: 'ніч',
  nightsMany: 'ночей',
  freeLeft: 'ще вільно',
  totalLabel: 'Загальна вартість',
  breakfast: 'Сніданок включено',
  choose: 'Обрати',
  yourDetails: 'Ваші дані',
  firstName: 'Імʼя',
  lastName: 'Прізвище',
  email: 'Email (необовʼязково)',
  emailHelp: 'Для підтвердження. Без email підтвердимо на рецепції.',
  bookNow: 'Забронювати номер',
  booking: 'Бронюємо…',
  heldFor: 'Тримаємо номер для вас {minutes} хвилин.',
  confirmTitle: 'Майже готово',
  confirmLead: 'Підтвердьте, будь ласка, бронювання. Одразу після цього можна заселятися.',
  confirm: 'Підтвердити бронювання',
  confirming: 'Підтверджуємо…',
  holdExpired: 'Час вийшов, і номер знову вільний. Пошукайте, будь ласка, ще раз.',
  roomTaken: 'Цей номер щойно зайняли. Оберіть інший або інші дати.',
  checkDetails: 'Перевірте, будь ласка, введені дані.',
  payAtReception: 'Оплата на рецепції — при заїзді або при виїзді.',
  bookingFailed: 'Забронювати не вдалося. Спробуйте ще раз або зателефонуйте на рецепцію.',
  justBooked: 'Я щойно забронював',
  claimTitle: 'Підтвердити ваше бронювання',
  claimLead: 'Введіть, будь ласка, своє прізвище та номер бронювання з підтвердження.',
  confirmationNo: 'Номер бронювання',
  confirmationHelp: 'З підтвердження від готелю.',
  claimSubmit: 'Далі до заселення',
  claiming: 'Перевіряємо…',
  needConfirmation: 'Введіть, будь ласка, номер бронювання.',
  needLastName: 'Введіть, будь ласка, своє прізвище.',
  needCheckIn: 'Введіть, будь ласка, дату заїзду.',
  checkInOutOfWindow: 'Ця сторінка — для заїзду сьогодні або завтра. Зверніться, будь ласка, на рецепцію.',
  extrasTitle: 'Додати щось іще?',
  extrasLead: 'Усе необовʼязкове — можна одразу далі.',
  extrasSkip: 'Далі без додатків',
  extrasNext: 'Продовжити',
  roomLabel: 'Номер',
  extrasLabel: 'Додатки',
  grandTotal: 'Разом',
  add: 'Додати',
  remove: 'Прибрати',
};

const pl: GuestStrings = {
  haveBooking: 'Mam rezerwację',
  haveBookingHelp: 'Zameldowanie i klucz do pokoju',
  noBooking: 'Potrzebuję pokoju',
  noBookingHelp: 'Zobacz wolne pokoje i zarezerwuj',
  welcome: 'Witamy',
  lead: 'W czym możemy pomóc?',
  findTitle: 'Znajdź swoją rezerwację',
  findLead: 'Telefon i nazwisko jak w rezerwacji.',
  phone: 'Numer telefonu',
  guestName: 'Imię i nazwisko',
  continue: 'Dalej',
  back: 'Wstecz',
  searching: 'Szukamy…',
  notFound: 'Nie udało się znaleźć rezerwacji. Prosimy sprawdzić dane lub skontaktować się z recepcją.',
  noPage: 'Rezerwacja istnieje, ale odprawa online nie jest dla niej włączona. Prosimy o kontakt z recepcją.',
  tooMany: 'Zbyt wiele prób. Prosimy spróbować ponownie za kwadrans.',
  stayTitle: 'Znajdź pokój',
  arrival: 'Przyjazd',
  departure: 'Wyjazd',
  guests: 'Dorośli',
  search: 'Szukaj',
  searchingRooms: 'Szukamy wolnych pokoi…',
  nothingFree: 'Na te terminy niestety nie mamy nic wolnego. Prosimy wybrać inne terminy lub zadzwonić na recepcję.',
  handoff: 'Ten obiekt przyjmuje rezerwacje na własnej stronie.',
  handoffOpen: 'Przejdź do strony rezerwacji',
  perNight: 'za noc',
  nightsOne: 'noc',
  nightsMany: 'nocy',
  freeLeft: 'jeszcze wolnych',
  totalLabel: 'Cena całkowita',
  breakfast: 'Śniadanie w cenie',
  choose: 'Wybierz',
  yourDetails: 'Twoje dane',
  firstName: 'Imię',
  lastName: 'Nazwisko',
  email: 'E-mail (opcjonalnie)',
  emailHelp: 'Do potwierdzenia. Bez e-maila potwierdzimy w recepcji.',
  bookNow: 'Zarezerwuj pokój',
  booking: 'Rezerwujemy…',
  heldFor: 'Trzymamy dla Państwa pokój przez {minutes} minut.',
  confirmTitle: 'Już prawie',
  confirmLead: 'Prosimy potwierdzić rezerwację. Zaraz potem można się zameldować.',
  confirm: 'Potwierdź rezerwację',
  confirming: 'Potwierdzamy…',
  holdExpired: 'Czas minął i pokój jest znowu wolny. Prosimy poszukać jeszcze raz.',
  roomTaken: 'Ten pokój został właśnie zajęty. Prosimy wybrać inny lub inne terminy.',
  checkDetails: 'Prosimy sprawdzić wprowadzone dane.',
  payAtReception: 'Płatność w recepcji — przy przyjeździe lub przy wyjeździe.',
  bookingFailed: 'Rezerwacja się nie powiodła. Prosimy spróbować ponownie lub zadzwonić na recepcję.',
  justBooked: 'Właśnie zarezerwowałem',
  claimTitle: 'Potwierdź swoją rezerwację',
  claimLead: 'Prosimy podać nazwisko i numer rezerwacji z potwierdzenia.',
  confirmationNo: 'Numer rezerwacji',
  confirmationHelp: 'Z potwierdzenia od hotelu.',
  claimSubmit: 'Przejdź do zameldowania',
  claiming: 'Sprawdzamy…',
  needConfirmation: 'Prosimy podać numer rezerwacji.',
  needLastName: 'Prosimy podać swoje nazwisko.',
  needCheckIn: 'Prosimy podać datę przyjazdu.',
  checkInOutOfWindow: 'Ta strona dotyczy przyjazdu dziś lub jutro. Prosimy o kontakt z recepcją.',
  extrasTitle: 'Coś jeszcze?',
  extrasLead: 'Wszystko opcjonalne — można przejść dalej.',
  extrasSkip: 'Dalej bez dodatków',
  extrasNext: 'Kontynuuj',
  roomLabel: 'Pokój',
  extrasLabel: 'Dodatki',
  grandTotal: 'Razem',
  add: 'Dodaj',
  remove: 'Usuń',
};

const nl: GuestStrings = {
  haveBooking: 'Ik heb een reservering',
  haveBookingHelp: 'Inchecken en uw kamersleutel ophalen',
  noBooking: 'Ik zoek een kamer',
  noBookingHelp: 'Beschikbaarheid bekijken en boeken',
  welcome: 'Welkom',
  lead: 'Waarmee kunnen we u helpen?',
  findTitle: 'Uw reservering zoeken',
  findLead: 'Telefoonnummer en naam zoals in de reservering.',
  phone: 'Telefoonnummer',
  guestName: 'Naam',
  continue: 'Verder',
  back: 'Terug',
  searching: 'Bezig met zoeken…',
  notFound: 'We konden de reservering niet vinden. Controleer de gegevens of neem contact op met de receptie.',
  noPage: 'Uw reservering bestaat, maar online inchecken is daarvoor niet ingeschakeld. Neem contact op met de receptie.',
  tooMany: 'Te veel pogingen. Probeer het over een kwartier opnieuw.',
  stayTitle: 'Een kamer zoeken',
  arrival: 'Aankomst',
  departure: 'Vertrek',
  guests: 'Volwassenen',
  search: 'Zoeken',
  searchingRooms: 'Bezig met zoeken naar vrije kamers…',
  nothingFree: 'Voor deze data hebben we helaas niets vrij. Kies andere data of bel de receptie.',
  handoff: 'Dit huis neemt reserveringen aan op de eigen website.',
  handoffOpen: 'Naar de reserveringspagina',
  perNight: 'per nacht',
  nightsOne: 'nacht',
  nightsMany: 'nachten',
  freeLeft: 'nog vrij',
  totalLabel: 'Totaalprijs',
  breakfast: 'Ontbijt inbegrepen',
  choose: 'Kiezen',
  yourDetails: 'Uw gegevens',
  firstName: 'Voornaam',
  lastName: 'Achternaam',
  email: 'E-mail (optioneel)',
  emailHelp: 'Voor de bevestiging. Zonder e-mail bevestigen we bij de receptie.',
  bookNow: 'Kamer reserveren',
  booking: 'Bezig met reserveren…',
  heldFor: 'We houden de kamer {minutes} minuten voor u vast.',
  confirmTitle: 'Bijna klaar',
  confirmLead: 'Bevestig de reservering. Daarna kunt u meteen inchecken.',
  confirm: 'Reservering bevestigen',
  confirming: 'Bezig met bevestigen…',
  holdExpired: 'De tijd is verstreken en de kamer is weer vrij. Zoek opnieuw.',
  roomTaken: 'Deze kamer is zojuist vergeven. Kies een andere kamer of andere data.',
  checkDetails: 'Controleer uw gegevens.',
  payAtReception: 'Betalen doet u bij de receptie — bij aankomst of bij vertrek.',
  bookingFailed: 'De reservering is niet gelukt. Probeer het opnieuw of bel de receptie.',
  justBooked: 'Ik heb zojuist geboekt',
  claimTitle: 'Uw reservering bevestigen',
  claimLead: 'Vul uw achternaam en het reserveringsnummer uit de bevestiging in.',
  confirmationNo: 'Reserveringsnummer',
  confirmationHelp: 'Uit de bevestiging van het hotel.',
  claimSubmit: 'Verder naar inchecken',
  claiming: 'Bezig met controleren…',
  needConfirmation: 'Vul het reserveringsnummer in.',
  needLastName: 'Vul uw achternaam in.',
  needCheckIn: 'Vul de aankomstdatum in.',
  checkInOutOfWindow: 'Deze pagina is voor aankomst vandaag of morgen. Neem contact op met de receptie.',
  extrasTitle: 'Nog iets erbij?',
  extrasLead: 'Alles optioneel — u kunt ook meteen verder.',
  extrasSkip: 'Verder zonder extras',
  extrasNext: 'Doorgaan',
  roomLabel: 'Kamer',
  extrasLabel: 'Extras',
  grandTotal: 'Totaal',
  add: 'Toevoegen',
  remove: 'Verwijderen',
};

const fr: GuestStrings = {
  haveBooking: 'J’ai une réservation',
  haveBookingHelp: 'Enregistrement et clé de chambre',
  noBooking: 'Je cherche une chambre',
  noBookingHelp: 'Voir les disponibilités et réserver',
  welcome: 'Bienvenue',
  lead: 'Comment pouvons-nous vous aider ?',
  findTitle: 'Retrouver votre réservation',
  findLead: 'Téléphone et nom comme dans la réservation.',
  phone: 'Numéro de téléphone',
  guestName: 'Nom',
  continue: 'Continuer',
  back: 'Retour',
  searching: 'Recherche…',
  notFound: 'Nous n’avons pas trouvé la réservation. Vérifiez les informations ou adressez-vous à la réception.',
  noPage: 'Votre réservation existe, mais l’enregistrement en ligne n’est pas activé pour elle. Adressez-vous à la réception.',
  tooMany: 'Trop de tentatives. Réessayez dans un quart d’heure.',
  stayTitle: 'Trouver une chambre',
  arrival: 'Arrivée',
  departure: 'Départ',
  guests: 'Adultes',
  search: 'Rechercher',
  searchingRooms: 'Recherche des chambres libres…',
  nothingFree: 'Nous n’avons rien de libre à ces dates. Choisissez d’autres dates ou appelez la réception.',
  handoff: 'Cet établissement prend les réservations sur son propre site.',
  handoffOpen: 'Aller à la page de réservation',
  perNight: 'par nuit',
  nightsOne: 'nuit',
  nightsMany: 'nuits',
  freeLeft: 'encore libres',
  totalLabel: 'Prix total',
  breakfast: 'Petit-déjeuner inclus',
  choose: 'Choisir',
  yourDetails: 'Vos coordonnées',
  firstName: 'Prénom',
  lastName: 'Nom de famille',
  email: 'E-mail (facultatif)',
  emailHelp: 'Pour la confirmation. Sans e-mail, nous confirmons à la réception.',
  bookNow: 'Réserver la chambre',
  booking: 'Réservation en cours…',
  heldFor: 'Nous gardons la chambre pour vous pendant {minutes} minutes.',
  confirmTitle: 'Presque terminé',
  confirmLead: 'Veuillez confirmer la réservation. Vous pourrez vous enregistrer juste après.',
  confirm: 'Confirmer la réservation',
  confirming: 'Confirmation…',
  holdExpired: 'Le délai est écoulé et la chambre est de nouveau libre. Relancez la recherche.',
  roomTaken: 'Cette chambre vient d’être prise. Choisissez-en une autre ou d’autres dates.',
  checkDetails: 'Veuillez vérifier vos informations.',
  payAtReception: 'Le paiement se fait à la réception — à l’arrivée ou au départ.',
  bookingFailed: 'La réservation n’a pas abouti. Réessayez ou appelez la réception.',
  justBooked: 'Je viens de réserver',
  claimTitle: 'Confirmer votre réservation',
  claimLead: 'Indiquez votre nom de famille et le numéro de réservation figurant sur la confirmation.',
  confirmationNo: 'Numéro de réservation',
  confirmationHelp: 'Depuis la confirmation de l’hôtel.',
  claimSubmit: 'Continuer vers l’enregistrement',
  claiming: 'Vérification…',
  needConfirmation: 'Veuillez indiquer le numéro de réservation.',
  needLastName: 'Veuillez indiquer votre nom de famille.',
  needCheckIn: 'Veuillez indiquer la date d’arrivée.',
  checkInOutOfWindow: 'Cette page concerne les arrivées d’aujourd’hui ou de demain. Adressez-vous à la réception.',
  extrasTitle: 'Autre chose ?',
  extrasLead: 'Tout est facultatif — vous pouvez continuer directement.',
  extrasSkip: 'Continuer sans extras',
  extrasNext: 'Poursuivre',
  roomLabel: 'Chambre',
  extrasLabel: 'Extras',
  grandTotal: 'Total',
  add: 'Ajouter',
  remove: 'Retirer',
};
/**
 * Усі мови продукту, і тип не дає забути жодного РЯДКА в жодній із них:
 * `Record<GuestLang, GuestStrings>` над `GuestLang = Language` — це сім
 * обовʼязкових блоків із однаковим набором ключів.
 *
 * Чого тип НЕ ловить і що стереже `guest-languages.check`: рядок, який на
 * місці, але лишився чужою мовою (копія німецького блоку з перейменованою
 * константою), і втрачений `{minutes}` — «тримаємо номер хвилин».
 */
export const GUEST_STRINGS: Record<GuestLang, GuestStrings> = { de, en, cs, uk, pl, nl, fr };
