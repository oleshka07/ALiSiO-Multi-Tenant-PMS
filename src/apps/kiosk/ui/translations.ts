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

/** Мова з памʼяті екрана; невідома — німецька (готель у DE-юрисдикції за КІ7). */
export function kioskLang(value: unknown): KioskLang {
  return value === 'en' ? 'en' : 'de';
}
