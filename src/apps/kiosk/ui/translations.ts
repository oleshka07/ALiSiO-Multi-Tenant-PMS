/**
 * Мова екрана в холі — DE і EN, і словник живе тут, а не в `t()`.
 *
 * ── Чому не `t()` ──────────────────────────────────────────────────────
 *
 * Три причини, і кожної окремо досить.
 *
 * 1. `t()` — це мова ОПЕРАТОРА: словники в `core/i18n/messages/` існують для
 *    того, щоб працівник готелю бачив адмінку своєю мовою. Біля термінала
 *    стоїть ГІСТЬ, і мову обирає він кнопкою на екрані. Інваріант 19 про це
 *    прямо: текст, який читає не оператор, не береться з `t()`.
 * 2. Англійського словника в `t()` НЕМАЄ. У `core/i18n/messages/` лежать
 *    `cs.json` і `de.json`; `en.json` довелося б завести цілком, бо
 *    `check-translations` вимагає 100 % покриття — це 3593 рядки адмінки
 *    заради двадцяти на терміналі.
 * 3. Так уже зроблено те саме: віджет бронювання (`modules/widget/ui/
 *    translations.ts`) — теж гостьова поверхня зі своїм словником і своїм
 *    перемикачем мов. Другий взірець для тієї самої задачі — це два взірці.
 *
 * Це відхилення від букви задачі («DE + EN через `t()`») і воно назване в
 * звіті блоку.
 *
 * ── Форма ──────────────────────────────────────────────────────────────
 *
 * `Record<KioskLang, KioskStrings>` з ОДНАКОВИМИ ключами: тип не дає забути
 * рядок в одній із мов — саме так на віджеті колись зникла половина
 * чеського екрана. Жодного слова конкретного готелю: назва, телефон, Wi-Fi
 * приходять із бази (інваріант 20).
 */

export const KIOSK_LANGS = ['de', 'en'] as const;
export type KioskLang = typeof KIOSK_LANGS[number];

export const KIOSK_LANG_LABELS: Record<KioskLang, string> = {
  de: 'Deutsch',
  en: 'English',
};

export interface KioskStrings {
  welcome: string;
  checkIn: string;
  checkOut: string;
  info: string;
  reception: string;
  callReception: string;
  whatsapp: string;
  bookNow: string;
  back: string;
  next: string;
  cancel: string;
  done: string;

  findTitle: string;
  lastName: string;
  arrivalDate: string;
  pickDate: string;
  extras: string;

  lookupTitle: string;
  lookupLead: string;
  byDate: string;
  byDateHelp: string;
  byConfirmation: string;
  byConfirmationHelp: string;
  byQr: string;
  byQrHelp: string;
  qrTitle: string;
  qrSoon: string;

  registerTitle: string;
  registerLead: string;
  firstName: string;
  nationality: string;
  addGuest: string;
  registered: string;
  registerDone: string;
  claimTitle: string;
  claimLead: string;
  claimSaved: string;
  confirmationNo: string;
  emailOrPhone: string;
  scanQr: string;
  needFactors: string;
  needMore: string;
  notFound: string;
  notFoundHelp: string;

  guestsTitle: string;
  scanDocument: string;
  scanDocumentHelp: string;
  documentReceived: string;
  enterByHand: string;
  consent: string;
  signTitle: string;
  signHelp: string;
  clearSignature: string;

  paymentTitle: string;
  paymentLater: string;

  keyTitle: string;
  yourRoom: string;
  lockCode: string;
  wifi: string;
  wifiPassword: string;

  checkoutTitle: string;
  balanceDue: string;
  payAtReception: string;
  invoiceByMail: string;
  summaryByMail: string;
  thankYou: string;

  walkinTitle: string;
  walkinOpen: string;
  justBooked: string;
  walkinAccepted: string;

  idleWarning: string;
  idleTitle: string;
}

const de: KioskStrings = {
  welcome: 'Willkommen',
  checkIn: 'Check-in',
  checkOut: 'Check-out',
  info: 'Info & Services',
  reception: 'Rezeption',
  callReception: 'Rezeption anrufen',
  whatsapp: 'WhatsApp',
  bookNow: 'Jetzt buchen',
  back: 'Zurück',
  next: 'Weiter',
  cancel: 'Abbrechen',
  done: 'Fertig',

  findTitle: 'Ihre Buchung finden',
  lastName: 'Nachname',
  arrivalDate: 'Anreisedatum',
  pickDate: 'Datum auswählen',
  extras: 'Extras',

  lookupTitle: 'Buchung finden',
  lookupLead: 'Wie möchten Sie Ihre Buchung finden?',
  byDate: 'Anreisedatum',
  byDateHelp: 'Suche mit Anreisedatum und Nachname.',
  byConfirmation: 'Buchungsnummer',
  byConfirmationHelp: 'Suche mit Buchungsnummer und Nachname.',
  byQr: 'QR-Code',
  byQrHelp: 'QR-Code scannen und am eigenen Handy fortfahren.',
  qrTitle: 'Am Handy fortfahren',
  qrSoon: 'Dieser Weg wird gerade eingerichtet. Bitte wählen Sie vorerst Anreisedatum oder Buchungsnummer.',

  registerTitle: 'Meldeschein',
  registerLead: 'Meldepflicht: bitte alle Gäste eintragen.',
  firstName: 'Vorname',
  nationality: 'Nationalität',
  addGuest: 'Gast hinzufügen',
  registered: 'Eingetragen',
  registerDone: 'Angaben gespeichert.',
  claimTitle: 'Buchung bestätigen',
  claimLead: 'Nachname, Buchungsnummer und Anreisedatum aus der Bestätigung.',
  claimSaved: 'Buchung übernommen. Sie können jetzt einchecken.',
  confirmationNo: 'Buchungsnummer',
  emailOrPhone: 'E-Mail oder Telefon',
  scanQr: 'QR-Code scannen',
  needFactors: 'Bitte zwei Angaben ausfüllen.',
  needMore: 'Bitte eine weitere Angabe ergänzen.',
  notFound: 'Keine Buchung gefunden.',
  notFoundHelp: 'Bitte wenden Sie sich an die Rezeption.',

  guestsTitle: 'Ihre Daten',
  scanDocument: 'Dokument mit dem Handy scannen',
  scanDocumentHelp: 'QR-Code mit der Handykamera öffnen und das Dokument fotografieren.',
  documentReceived: 'Dokument erhalten',
  enterByHand: 'Von Hand eingeben',
  consent: 'Ich stimme der Verarbeitung meiner Daten zu.',
  signTitle: 'Meldeschein unterschreiben',
  signHelp: 'Mit dem Finger unterschreiben.',
  clearSignature: 'Löschen',

  paymentTitle: 'Bezahlung',
  paymentLater: 'Die Bezahlung erfolgt morgen an der Rezeption oder bei der Abreise.',

  keyTitle: 'Ihr Zimmer',
  yourRoom: 'Zimmer',
  lockCode: 'Code für den Schlüsselkasten',
  wifi: 'WLAN',
  wifiPassword: 'Passwort',

  checkoutTitle: 'Abreise',
  balanceDue: 'Offener Betrag',
  payAtReception: 'Bitte an der Rezeption bezahlen.',
  invoiceByMail: 'Die Rechnung erhalten Sie per E-Mail.',
  summaryByMail: 'Die Übersicht erhalten Sie per E-Mail.',
  thankYou: 'Danke für Ihren Aufenthalt!',

  walkinTitle: 'Zimmer buchen',
  walkinOpen: 'Buchungsseite öffnen',
  justBooked: 'Ich habe gerade gebucht',
  walkinAccepted: 'Buchung angenommen. Sie können jetzt einchecken.',

  idleWarning: 'Sind Sie noch da?',
  idleTitle: 'Der Bildschirm wird zurückgesetzt.',
};

const en: KioskStrings = {
  welcome: 'Welcome',
  checkIn: 'Check-in',
  checkOut: 'Check-out',
  info: 'Info & Services',
  reception: 'Reception',
  callReception: 'Call reception',
  whatsapp: 'WhatsApp',
  bookNow: 'Book now',
  back: 'Back',
  next: 'Next',
  cancel: 'Cancel',
  done: 'Done',

  findTitle: 'Find your booking',
  lastName: 'Last name',
  arrivalDate: 'Arrival date',
  pickDate: 'Choose a date',
  extras: 'Extras',

  lookupTitle: 'Find your booking',
  lookupLead: 'How would you like to find your booking?',
  byDate: 'Arrival date',
  byDateHelp: 'Search by arrival date and last name.',
  byConfirmation: 'Booking number',
  byConfirmationHelp: 'Search by booking number and last name.',
  byQr: 'QR code',
  byQrHelp: 'Scan the QR code and continue on your phone.',
  qrTitle: 'Continue on your phone',
  qrSoon: 'This way is being set up. For now, please choose arrival date or booking number.',

  registerTitle: 'Registration form',
  registerLead: 'Required by law: please enter all guests.',
  firstName: 'First name',
  nationality: 'Nationality',
  addGuest: 'Add guest',
  registered: 'Registered',
  registerDone: 'Details saved.',
  claimTitle: 'Confirm your booking',
  claimLead: 'Last name, booking number and arrival date from your confirmation.',
  claimSaved: 'Booking accepted. You can check in now.',
  confirmationNo: 'Booking number',
  emailOrPhone: 'E-mail or phone',
  scanQr: 'Scan QR code',
  needFactors: 'Please fill in two details.',
  needMore: 'Please add one more detail.',
  notFound: 'No booking found.',
  notFoundHelp: 'Please contact the reception.',

  guestsTitle: 'Your details',
  scanDocument: 'Scan document with your phone',
  scanDocumentHelp: 'Open the QR code with your phone camera and photograph the document.',
  documentReceived: 'Document received',
  enterByHand: 'Enter by hand',
  consent: 'I agree to the processing of my data.',
  signTitle: 'Sign the registration form',
  signHelp: 'Sign with your finger.',
  clearSignature: 'Clear',

  paymentTitle: 'Payment',
  paymentLater: 'Payment is made tomorrow at the reception or on departure.',

  keyTitle: 'Your room',
  yourRoom: 'Room',
  lockCode: 'Key box code',
  wifi: 'Wi-Fi',
  wifiPassword: 'Password',

  checkoutTitle: 'Departure',
  balanceDue: 'Outstanding balance',
  payAtReception: 'Please pay at the reception.',
  invoiceByMail: 'You will receive the invoice by e-mail.',
  summaryByMail: 'You will receive the summary by e-mail.',
  thankYou: 'Thank you for your stay!',

  walkinTitle: 'Book a room',
  walkinOpen: 'Open booking page',
  justBooked: 'I have just booked',
  walkinAccepted: 'Booking accepted. You can check in now.',

  idleWarning: 'Are you still there?',
  idleTitle: 'The screen will be reset.',
};

export const KIOSK_STRINGS: Record<KioskLang, KioskStrings> = { de, en };

/**
 * Чому термінал не пустив — СЛОВАМИ, і рідною мовою гостя.
 *
 * ── Навіщо окрема мапа ──────────────────────────────────────────────────
 *
 * Фасади відмовляють КОДОМ (`no_unit`, `unit_dirty`, `payment_required`,
 * `balance_blocking`…), і код їде на екран у полі `error`. Перша редакція
 * екрана робила з усього цього одне речення «зверніться на рецепцію», а на
 * кроці картки не показувала й того: гість тиснув «Check-in», сервер чесно
 * відмовляв 409-ю, і на екрані НЕ ВІДБУВАЛОСЯ НІЧОГО. Найгірший вигляд
 * поломки в холі: кнопка, яка не реагує, і немає кому сказати чому.
 *
 * Показувати сам код не можна — це той самий рід, що `e.message` клієнту
 * (інваріант 6): «no_clean_unit» нічого не означає для людини з валізою.
 * Тому на кожен код — речення, яке ми написали самі, і воно каже, що гостю
 * РОБИТИ, а не що сталося в базі.
 *
 * Коду, якого тут немає, відповідає `notFoundHelp` — «зверніться на
 * рецепцію». Це свідомий запас: новий код фасаду не лишає екран мовчазним,
 * а лише менш точним. Сцена 30 не дає цьому запасу стати нормою — вона
 * ганяє живі відмови через хендлер і вимагає речення на кожну.
 */
export type KioskRefusal =
  | 'not_registered' | 'payment_required' | 'unit_dirty' | 'no_unit'
  | 'no_unit_type' | 'no_free_unit' | 'no_clean_unit'
  | 'too_early' | 'balance_blocking' | 'not_found';

export const KIOSK_REFUSAL_CODES: KioskRefusal[] = [
  'not_registered', 'payment_required', 'unit_dirty', 'no_unit',
  'no_unit_type', 'no_free_unit', 'no_clean_unit',
  'too_early', 'balance_blocking', 'not_found',
];

export const KIOSK_REFUSALS: Record<KioskLang, Record<KioskRefusal, string>> = {
  de: {
    not_registered: 'Bitte tragen Sie zuerst alle Gäste ein.',
    payment_required: 'Diese Buchung ist noch nicht bezahlt. Bitte wenden Sie sich an die Rezeption.',
    unit_dirty: 'Ihr Zimmer wird gerade vorbereitet. Bitte wenden Sie sich an die Rezeption.',
    no_unit: 'Ihr Zimmer wird an der Rezeption vergeben. Bitte melden Sie sich dort.',
    no_unit_type: 'Für diese Buchung ist keine Zimmerkategorie hinterlegt. Bitte wenden Sie sich an die Rezeption.',
    no_free_unit: 'Im Moment ist kein Zimmer frei. Bitte wenden Sie sich an die Rezeption.',
    no_clean_unit: 'Ihr Zimmer wird gerade vorbereitet. Bitte wenden Sie sich an die Rezeption.',
    too_early: 'Der Check-in ist ab {time} möglich.',
    balance_blocking: 'Es ist noch ein Betrag offen. Bitte an der Rezeption bezahlen.',
    not_found: 'Diese Buchung wurde nicht gefunden. Bitte wenden Sie sich an die Rezeption.',
  },
  en: {
    not_registered: 'Please enter all guests first.',
    payment_required: 'This booking has not been paid yet. Please contact the reception.',
    unit_dirty: 'Your room is still being prepared. Please contact the reception.',
    no_unit: 'Your room is assigned at the reception. Please go there.',
    no_unit_type: 'No room category is set for this booking. Please contact the reception.',
    no_free_unit: 'No room is free at the moment. Please contact the reception.',
    no_clean_unit: 'Your room is still being prepared. Please contact the reception.',
    too_early: 'Check-in is possible from {time}.',
    balance_blocking: 'An amount is still outstanding. Please pay at the reception.',
    not_found: 'This booking was not found. Please contact the reception.',
  },
};

/**
 * Речення на відмову. Невідомий код — «зверніться на рецепцію», НІКОЛИ сам код.
 *
 * `{time}` підставляється лише там, де сервер назвав годину: «з {time}» без
 * години — це гірше за загальне речення, бо виглядає як зламаний текст.
 */
export function refusalText(lang: KioskLang, code: unknown, time?: unknown): string {
  const dict = KIOSK_REFUSALS[lang];
  const key = typeof code === 'string' && code in dict ? (code as KioskRefusal) : null;
  if (!key) return KIOSK_STRINGS[lang].notFoundHelp;
  const line = dict[key];
  if (!line.includes('{time}')) return line;
  return typeof time === 'string' && time
    ? line.replace('{time}', time)
    : KIOSK_STRINGS[lang].notFoundHelp;
}

/** Мова з памʼяті екрана; невідома — німецька (готель у DE-юрисдикції за КІ7). */
export function kioskLang(value: unknown): KioskLang {
  return value === 'en' ? 'en' : 'de';
}
