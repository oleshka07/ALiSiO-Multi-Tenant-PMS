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

import { LANGUAGE_CODES, LANGUAGES, isLanguage, type Language } from '@core/i18n/languages';

/**
 * Мови екрана — рівно ті, які знає продукт, а не власний список.
 *
 * Тут стояло `['de', 'en']`, і це був шостий список мов у проєкті при тому,
 * що `core/i18n/languages.ts` заведений саме щоб списку був один (його шапка
 * перелічує чотири попередні). Наслідок бачив гість, а не ми: чех у холі
 * німецького готелю тиснув на єдині дві кнопки й читав чужою мовою, поки
 * сусідня гостьова сторінка вже говорила сімома.
 */
export const KIOSK_LANGS = LANGUAGE_CODES;
export type KioskLang = Language;

/**
 * Підпис — РІДНОЮ назвою мови.
 *
 * Не код («DE/EN/CZ»): біля термінала стоїть людина, яка шукає в списку
 * слово, що впізнає. Код упізнає той, хто вже знає, що шукати.
 */
export const KIOSK_LANG_LABELS: Record<KioskLang, string> = Object.fromEntries(
  LANGUAGE_CODES.map((code) => [code, LANGUAGES[code].native]),
) as Record<KioskLang, string>;

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

const cs: KioskStrings = {
  welcome: 'Vítejte',
  checkIn: 'Odbavení',
  checkOut: 'Odhlášení',
  info: 'Informace a služby',
  reception: 'Recepce',
  callReception: 'Zavolat na recepci',
  whatsapp: 'WhatsApp',
  bookNow: 'Rezervovat',
  back: 'Zpět',
  next: 'Dále',
  cancel: 'Zrušit',
  done: 'Hotovo',
  findTitle: 'Najít vaši rezervaci',
  lastName: 'Příjmení',
  arrivalDate: 'Datum příjezdu',
  pickDate: 'Vyberte datum',
  extras: 'Doplňky',
  lookupTitle: 'Najít rezervaci',
  lookupLead: 'Jak chcete svou rezervaci najít?',
  byDate: 'Podle data příjezdu',
  byDateHelp: 'Vyhledání podle data příjezdu a příjmení.',
  byConfirmation: 'Podle čísla rezervace',
  byConfirmationHelp: 'Vyhledání podle čísla rezervace a příjmení.',
  byQr: 'QR kód',
  byQrHelp: 'Naskenujte QR kód a pokračujte na svém telefonu.',
  qrTitle: 'Pokračovat na telefonu',
  qrSoon: 'Tato cesta se právě připravuje. Zvolte zatím prosím datum příjezdu nebo číslo rezervace.',
  registerTitle: 'Přihlašovací formulář',
  registerLead: 'Zákonná povinnost: zapište prosím všechny hosty.',
  firstName: 'Jméno',
  nationality: 'Státní příslušnost',
  addGuest: 'Přidat hosta',
  registered: 'Zapsán',
  registerDone: 'Údaje uloženy.',
  claimTitle: 'Potvrdit rezervaci',
  claimLead: 'Příjmení, číslo rezervace a datum příjezdu z potvrzení.',
  claimSaved: 'Rezervace převzata. Nyní se můžete odbavit.',
  confirmationNo: 'Číslo rezervace',
  emailOrPhone: 'E-mail nebo telefon',
  scanQr: 'Naskenovat QR kód',
  needFactors: 'Vyplňte prosím dva údaje.',
  needMore: 'Doplňte prosím ještě jeden údaj.',
  notFound: 'Rezervace nenalezena.',
  notFoundHelp: 'Obraťte se prosím na recepci.',
  guestsTitle: 'Vaše údaje',
  scanDocument: 'Naskenovat doklad telefonem',
  scanDocumentHelp: 'Otevřete QR kód fotoaparátem telefonu a doklad vyfotografujte.',
  documentReceived: 'Doklad přijat',
  enterByHand: 'Zadat ručně',
  consent: 'Souhlasím se zpracováním svých údajů.',
  signTitle: 'Podepsat přihlašovací formulář',
  signHelp: 'Podepište se prstem.',
  clearSignature: 'Smazat',
  paymentTitle: 'Platba',
  paymentLater: 'Platba proběhne zítra na recepci nebo při odjezdu.',
  keyTitle: 'Váš pokoj',
  yourRoom: 'Pokoj',
  lockCode: 'Kód k schránce na klíče',
  wifi: 'Wi-Fi',
  wifiPassword: 'Heslo',
  checkoutTitle: 'Odjezd',
  balanceDue: 'Zbývá uhradit',
  payAtReception: 'Uhraďte prosím na recepci.',
  invoiceByMail: 'Fakturu obdržíte e-mailem.',
  summaryByMail: 'Přehled obdržíte e-mailem.',
  thankYou: 'Děkujeme za váš pobyt!',
  walkinTitle: 'Rezervovat pokoj',
  walkinOpen: 'Otevřít rezervační stránku',
  justBooked: 'Právě jsem rezervoval',
  walkinAccepted: 'Rezervace přijata. Nyní se můžete odbavit.',
  idleWarning: 'Jste tu ještě?',
  idleTitle: 'Obrazovka se vrátí na začátek.',
};

const uk: KioskStrings = {
  welcome: 'Вітаємо',
  checkIn: 'Заселення',
  checkOut: 'Виїзд',
  info: 'Інформація та послуги',
  reception: 'Рецепція',
  callReception: 'Зателефонувати на рецепцію',
  whatsapp: 'WhatsApp',
  bookNow: 'Забронювати',
  back: 'Назад',
  next: 'Далі',
  cancel: 'Скасувати',
  done: 'Готово',
  findTitle: 'Знайти ваше бронювання',
  lastName: 'Прізвище',
  arrivalDate: 'Дата заїзду',
  pickDate: 'Оберіть дату',
  extras: 'Додатки',
  lookupTitle: 'Знайти бронювання',
  lookupLead: 'Як вам зручніше знайти своє бронювання?',
  byDate: 'За датою заїзду',
  byDateHelp: 'Пошук за датою заїзду та прізвищем.',
  byConfirmation: 'За номером бронювання',
  byConfirmationHelp: 'Пошук за номером бронювання та прізвищем.',
  byQr: 'QR-код',
  byQrHelp: 'Відскануйте QR-код і продовжуйте на своєму телефоні.',
  qrTitle: 'Продовжити на телефоні',
  qrSoon: 'Цей спосіб ще налаштовується. Поки що оберіть дату заїзду або номер бронювання.',
  registerTitle: 'Реєстраційна картка',
  registerLead: 'За законом: впишіть, будь ласка, усіх гостей.',
  firstName: 'Імʼя',
  nationality: 'Громадянство',
  addGuest: 'Додати гостя',
  registered: 'Внесено',
  registerDone: 'Дані збережено.',
  claimTitle: 'Підтвердити бронювання',
  claimLead: 'Прізвище, номер бронювання і дата заїзду з підтвердження.',
  claimSaved: 'Бронювання прийнято. Тепер можна заселятися.',
  confirmationNo: 'Номер бронювання',
  emailOrPhone: 'Email або телефон',
  scanQr: 'Сканувати QR-код',
  needFactors: 'Заповніть, будь ласка, два поля.',
  needMore: 'Додайте, будь ласка, ще одне поле.',
  notFound: 'Бронювання не знайдено.',
  notFoundHelp: 'Зверніться, будь ласка, на рецепцію.',
  guestsTitle: 'Ваші дані',
  scanDocument: 'Сканувати документ телефоном',
  scanDocumentHelp: 'Відкрийте QR-код камерою телефона і сфотографуйте документ.',
  documentReceived: 'Документ отримано',
  enterByHand: 'Ввести вручну',
  consent: 'Погоджуюся на обробку моїх даних.',
  signTitle: 'Підписати реєстраційну картку',
  signHelp: 'Підпишіться пальцем.',
  clearSignature: 'Стерти',
  paymentTitle: 'Оплата',
  paymentLater: 'Оплата — завтра на рецепції або при виїзді.',
  keyTitle: 'Ваш номер',
  yourRoom: 'Номер',
  lockCode: 'Код від скриньки з ключем',
  wifi: 'Wi-Fi',
  wifiPassword: 'Пароль',
  checkoutTitle: 'Виїзд',
  balanceDue: 'До сплати',
  payAtReception: 'Сплатіть, будь ласка, на рецепції.',
  invoiceByMail: 'Рахунок надішлемо на email.',
  summaryByMail: 'Підсумок надішлемо на email.',
  thankYou: 'Дякуємо, що були в нас!',
  walkinTitle: 'Забронювати номер',
  walkinOpen: 'Відкрити сторінку бронювання',
  justBooked: 'Я щойно забронював',
  walkinAccepted: 'Бронювання прийнято. Тепер можна заселятися.',
  idleWarning: 'Ви ще тут?',
  idleTitle: 'Екран повернеться на початок.',
};

const pl: KioskStrings = {
  welcome: 'Witamy',
  checkIn: 'Zameldowanie',
  checkOut: 'Wymeldowanie',
  info: 'Informacje i usługi',
  reception: 'Recepcja',
  callReception: 'Zadzwoń na recepcję',
  whatsapp: 'WhatsApp',
  bookNow: 'Zarezerwuj',
  back: 'Wstecz',
  next: 'Dalej',
  cancel: 'Anuluj',
  done: 'Gotowe',
  findTitle: 'Znajdź swoją rezerwację',
  lastName: 'Nazwisko',
  arrivalDate: 'Data przyjazdu',
  pickDate: 'Wybierz datę',
  extras: 'Dodatki',
  lookupTitle: 'Znajdź rezerwację',
  lookupLead: 'Jak chcesz znaleźć swoją rezerwację?',
  byDate: 'Po dacie przyjazdu',
  byDateHelp: 'Wyszukiwanie po dacie przyjazdu i nazwisku.',
  byConfirmation: 'Po numerze rezerwacji',
  byConfirmationHelp: 'Wyszukiwanie po numerze rezerwacji i nazwisku.',
  byQr: 'Kod QR',
  byQrHelp: 'Zeskanuj kod QR i kontynuuj na swoim telefonie.',
  qrTitle: 'Kontynuuj na telefonie',
  qrSoon: 'Ta droga jest właśnie przygotowywana. Prosimy wybrać na razie datę przyjazdu lub numer rezerwacji.',
  registerTitle: 'Karta meldunkowa',
  registerLead: 'Wymóg prawny: prosimy wpisać wszystkich gości.',
  firstName: 'Imię',
  nationality: 'Obywatelstwo',
  addGuest: 'Dodaj gościa',
  registered: 'Wpisany',
  registerDone: 'Dane zapisane.',
  claimTitle: 'Potwierdź rezerwację',
  claimLead: 'Nazwisko, numer rezerwacji i data przyjazdu z potwierdzenia.',
  claimSaved: 'Rezerwacja przyjęta. Można się teraz zameldować.',
  confirmationNo: 'Numer rezerwacji',
  emailOrPhone: 'E-mail lub telefon',
  scanQr: 'Zeskanuj kod QR',
  needFactors: 'Prosimy wypełnić dwa pola.',
  needMore: 'Prosimy uzupełnić jeszcze jedno pole.',
  notFound: 'Nie znaleziono rezerwacji.',
  notFoundHelp: 'Prosimy o kontakt z recepcją.',
  guestsTitle: 'Twoje dane',
  scanDocument: 'Zeskanuj dokument telefonem',
  scanDocumentHelp: 'Otwórz kod QR aparatem telefonu i sfotografuj dokument.',
  documentReceived: 'Dokument otrzymany',
  enterByHand: 'Wpisz ręcznie',
  consent: 'Wyrażam zgodę na przetwarzanie moich danych.',
  signTitle: 'Podpisz kartę meldunkową',
  signHelp: 'Podpisz się palcem.',
  clearSignature: 'Wyczyść',
  paymentTitle: 'Płatność',
  paymentLater: 'Płatność nastąpi jutro w recepcji lub przy wyjeździe.',
  keyTitle: 'Twój pokój',
  yourRoom: 'Pokój',
  lockCode: 'Kod do skrytki na klucze',
  wifi: 'Wi-Fi',
  wifiPassword: 'Hasło',
  checkoutTitle: 'Wyjazd',
  balanceDue: 'Do zapłaty',
  payAtReception: 'Prosimy zapłacić w recepcji.',
  invoiceByMail: 'Fakturę otrzymasz e-mailem.',
  summaryByMail: 'Podsumowanie otrzymasz e-mailem.',
  thankYou: 'Dziękujemy za pobyt!',
  walkinTitle: 'Zarezerwuj pokój',
  walkinOpen: 'Otwórz stronę rezerwacji',
  justBooked: 'Właśnie zarezerwowałem',
  walkinAccepted: 'Rezerwacja przyjęta. Można się teraz zameldować.',
  idleWarning: 'Czy jesteś jeszcze tutaj?',
  idleTitle: 'Ekran wróci na początek.',
};

const nl: KioskStrings = {
  welcome: 'Welkom',
  checkIn: 'Inchecken',
  checkOut: 'Uitchecken',
  info: 'Informatie en services',
  reception: 'Receptie',
  callReception: 'Receptie bellen',
  whatsapp: 'WhatsApp',
  bookNow: 'Nu boeken',
  back: 'Terug',
  next: 'Verder',
  cancel: 'Annuleren',
  done: 'Klaar',
  findTitle: 'Uw reservering zoeken',
  lastName: 'Achternaam',
  arrivalDate: 'Aankomstdatum',
  pickDate: 'Kies een datum',
  extras: 'Extras',
  lookupTitle: 'Reservering zoeken',
  lookupLead: 'Hoe wilt u uw reservering zoeken?',
  byDate: 'Op aankomstdatum',
  byDateHelp: 'Zoeken op aankomstdatum en achternaam.',
  byConfirmation: 'Op reserveringsnummer',
  byConfirmationHelp: 'Zoeken op reserveringsnummer en achternaam.',
  byQr: 'QR-code',
  byQrHelp: 'Scan de QR-code en ga verder op uw telefoon.',
  qrTitle: 'Verder op uw telefoon',
  qrSoon: 'Deze manier wordt nog ingericht. Kies voorlopig aankomstdatum of reserveringsnummer.',
  registerTitle: 'Registratieformulier',
  registerLead: 'Wettelijk verplicht: vul alle gasten in.',
  firstName: 'Voornaam',
  nationality: 'Nationaliteit',
  addGuest: 'Gast toevoegen',
  registered: 'Ingevuld',
  registerDone: 'Gegevens opgeslagen.',
  claimTitle: 'Reservering bevestigen',
  claimLead: 'Achternaam, reserveringsnummer en aankomstdatum uit uw bevestiging.',
  claimSaved: 'Reservering overgenomen. U kunt nu inchecken.',
  confirmationNo: 'Reserveringsnummer',
  emailOrPhone: 'E-mail of telefoon',
  scanQr: 'QR-code scannen',
  needFactors: 'Vul twee gegevens in.',
  needMore: 'Vul nog één gegeven aan.',
  notFound: 'Geen reservering gevonden.',
  notFoundHelp: 'Neem contact op met de receptie.',
  guestsTitle: 'Uw gegevens',
  scanDocument: 'Document scannen met uw telefoon',
  scanDocumentHelp: 'Open de QR-code met uw telefooncamera en fotografeer het document.',
  documentReceived: 'Document ontvangen',
  enterByHand: 'Handmatig invoeren',
  consent: 'Ik ga akkoord met de verwerking van mijn gegevens.',
  signTitle: 'Registratieformulier ondertekenen',
  signHelp: 'Onderteken met uw vinger.',
  clearSignature: 'Wissen',
  paymentTitle: 'Betaling',
  paymentLater: 'Betalen doet u morgen bij de receptie of bij vertrek.',
  keyTitle: 'Uw kamer',
  yourRoom: 'Kamer',
  lockCode: 'Code voor de sleutelkluis',
  wifi: 'Wifi',
  wifiPassword: 'Wachtwoord',
  checkoutTitle: 'Vertrek',
  balanceDue: 'Openstaand bedrag',
  payAtReception: 'Betaal bij de receptie.',
  invoiceByMail: 'U ontvangt de factuur per e-mail.',
  summaryByMail: 'U ontvangt het overzicht per e-mail.',
  thankYou: 'Bedankt voor uw verblijf!',
  walkinTitle: 'Een kamer boeken',
  walkinOpen: 'Boekingspagina openen',
  justBooked: 'Ik heb zojuist geboekt',
  walkinAccepted: 'Reservering aangenomen. U kunt nu inchecken.',
  idleWarning: 'Bent u er nog?',
  idleTitle: 'Het scherm gaat terug naar het begin.',
};

const fr: KioskStrings = {
  welcome: 'Bienvenue',
  checkIn: 'Enregistrement',
  checkOut: 'Départ',
  info: 'Informations et services',
  reception: 'Réception',
  callReception: 'Appeler la réception',
  whatsapp: 'WhatsApp',
  bookNow: 'Réserver',
  back: 'Retour',
  next: 'Suivant',
  cancel: 'Annuler',
  done: 'Terminé',
  findTitle: 'Retrouver votre réservation',
  lastName: 'Nom de famille',
  arrivalDate: 'Date d’arrivée',
  pickDate: 'Choisir une date',
  extras: 'Extras',
  lookupTitle: 'Retrouver la réservation',
  lookupLead: 'Comment souhaitez-vous retrouver votre réservation ?',
  byDate: 'Par date d’arrivée',
  byDateHelp: 'Recherche par date d’arrivée et nom de famille.',
  byConfirmation: 'Par numéro de réservation',
  byConfirmationHelp: 'Recherche par numéro de réservation et nom de famille.',
  byQr: 'Code QR',
  byQrHelp: 'Scannez le code QR et continuez sur votre téléphone.',
  qrTitle: 'Continuer sur votre téléphone',
  qrSoon: 'Cette voie est en cours de mise en place. Choisissez pour l’instant la date d’arrivée ou le numéro de réservation.',
  registerTitle: 'Fiche de police',
  registerLead: 'Obligation légale : veuillez inscrire tous les occupants.',
  firstName: 'Prénom',
  nationality: 'Nationalité',
  addGuest: 'Ajouter un occupant',
  registered: 'Inscrit',
  registerDone: 'Informations enregistrées.',
  claimTitle: 'Confirmer la réservation',
  claimLead: 'Nom de famille, numéro de réservation et date d’arrivée figurant sur la confirmation.',
  claimSaved: 'Réservation reprise. Vous pouvez maintenant vous enregistrer.',
  confirmationNo: 'Numéro de réservation',
  emailOrPhone: 'E-mail ou téléphone',
  scanQr: 'Scanner le code QR',
  needFactors: 'Veuillez remplir deux informations.',
  needMore: 'Veuillez ajouter une information de plus.',
  notFound: 'Aucune réservation trouvée.',
  notFoundHelp: 'Adressez-vous à la réception.',
  guestsTitle: 'Vos coordonnées',
  scanDocument: 'Scanner le document avec votre téléphone',
  scanDocumentHelp: 'Ouvrez le code QR avec l’appareil photo du téléphone et photographiez le document.',
  documentReceived: 'Document reçu',
  enterByHand: 'Saisir à la main',
  consent: 'J’accepte le traitement de mes données.',
  signTitle: 'Signer la fiche de police',
  signHelp: 'Signez avec le doigt.',
  clearSignature: 'Effacer',
  paymentTitle: 'Paiement',
  paymentLater: 'Le paiement se fera demain à la réception ou au départ.',
  keyTitle: 'Votre chambre',
  yourRoom: 'Chambre',
  lockCode: 'Code du coffre à clés',
  wifi: 'Wi-Fi',
  wifiPassword: 'Mot de passe',
  checkoutTitle: 'Départ du séjour',
  balanceDue: 'Reste à payer',
  payAtReception: 'Veuillez régler à la réception.',
  invoiceByMail: 'Vous recevrez la facture par e-mail.',
  summaryByMail: 'Vous recevrez le récapitulatif par e-mail.',
  thankYou: 'Merci pour votre séjour !',
  walkinTitle: 'Réserver une chambre',
  walkinOpen: 'Ouvrir la page de réservation',
  justBooked: 'Je viens de réserver',
  walkinAccepted: 'Réservation acceptée. Vous pouvez maintenant vous enregistrer.',
  idleWarning: 'Êtes-vous toujours là ?',
  idleTitle: 'L’écran va revenir au début.',
};
/**
 * Усі мови продукту. Тип тримає повноту КЛЮЧІВ; що рядок не лишився чужою
 * мовою і що `{…}`-підстановки на місці — стереже `guest-languages.check`.
 */
export const KIOSK_STRINGS: Record<KioskLang, KioskStrings> = { de, en, cs, uk, pl, nl, fr };

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
  cs: {
    not_registered: 'Zapište prosím nejprve všechny hosty.',
    payment_required: 'Tato rezervace zatím není uhrazena. Obraťte se prosím na recepci.',
    unit_dirty: 'Váš pokoj se právě připravuje. Obraťte se prosím na recepci.',
    no_unit: 'Váš pokoj se přiděluje na recepci. Přihlaste se prosím tam.',
    no_unit_type: 'K této rezervaci není nastavena kategorie pokoje. Obraťte se prosím na recepci.',
    no_free_unit: 'Momentálně není volný žádný pokoj. Obraťte se prosím na recepci.',
    no_clean_unit: 'Váš pokoj se ještě uklízí. Obraťte se prosím na recepci.',
    too_early: 'Odbavit se můžete od {time}.',
    balance_blocking: 'Zůstává neuhrazená částka. Uhraďte ji prosím na recepci.',
    not_found: 'Tato rezervace nebyla nalezena. Obraťte se prosím na recepci.',
  },
  uk: {
    not_registered: 'Спершу впишіть, будь ласка, усіх гостей.',
    payment_required: 'Це бронювання ще не оплачене. Зверніться, будь ласка, на рецепцію.',
    unit_dirty: 'Ваш номер саме готують. Зверніться, будь ласка, на рецепцію.',
    no_unit: 'Ваш номер призначають на рецепції. Підійдіть, будь ласка, туди.',
    no_unit_type: 'Для цього бронювання не вказано категорію номера. Зверніться, будь ласка, на рецепцію.',
    no_free_unit: 'Зараз вільних номерів немає. Зверніться, будь ласка, на рецепцію.',
    no_clean_unit: 'Ваш номер ще прибирають. Зверніться, будь ласка, на рецепцію.',
    too_early: 'Заселитися можна з {time}.',
    balance_blocking: 'Лишилася несплачена сума. Сплатіть її, будь ласка, на рецепції.',
    not_found: 'Це бронювання не знайдено. Зверніться, будь ласка, на рецепцію.',
  },
  pl: {
    not_registered: 'Prosimy najpierw wpisać wszystkich gości.',
    payment_required: 'Ta rezerwacja nie jest jeszcze opłacona. Prosimy o kontakt z recepcją.',
    unit_dirty: 'Pokój jest właśnie przygotowywany. Prosimy o kontakt z recepcją.',
    no_unit: 'Pokój przydzielany jest w recepcji. Prosimy zgłosić się tam.',
    no_unit_type: 'Do tej rezerwacji nie przypisano kategorii pokoju. Prosimy o kontakt z recepcją.',
    no_free_unit: 'W tej chwili nie ma wolnego pokoju. Prosimy o kontakt z recepcją.',
    no_clean_unit: 'Pokój jest jeszcze sprzątany. Prosimy o kontakt z recepcją.',
    too_early: 'Zameldowanie możliwe od {time}.',
    balance_blocking: 'Pozostała kwota do zapłaty. Prosimy uregulować ją w recepcji.',
    not_found: 'Nie znaleziono tej rezerwacji. Prosimy o kontakt z recepcją.',
  },
  nl: {
    not_registered: 'Vul eerst alle gasten in.',
    payment_required: 'Deze reservering is nog niet betaald. Neem contact op met de receptie.',
    unit_dirty: 'Uw kamer wordt nog klaargemaakt. Neem contact op met de receptie.',
    no_unit: 'Uw kamer wordt bij de receptie toegewezen. Meld u daar.',
    no_unit_type: 'Voor deze reservering is geen kamercategorie ingesteld. Neem contact op met de receptie.',
    no_free_unit: 'Op dit moment is er geen kamer vrij. Neem contact op met de receptie.',
    no_clean_unit: 'Uw kamer wordt nog schoongemaakt. Neem contact op met de receptie.',
    too_early: 'Inchecken kan vanaf {time}.',
    balance_blocking: 'Er staat nog een bedrag open. Betaal dit bij de receptie.',
    not_found: 'Deze reservering is niet gevonden. Neem contact op met de receptie.',
  },
  fr: {
    not_registered: 'Veuillez d’abord inscrire tous les occupants.',
    payment_required: 'Cette réservation n’est pas encore réglée. Adressez-vous à la réception.',
    unit_dirty: 'Votre chambre est en cours de préparation. Adressez-vous à la réception.',
    no_unit: 'Votre chambre est attribuée à la réception. Présentez-vous là-bas.',
    no_unit_type: 'Aucune catégorie de chambre n’est définie pour cette réservation. Adressez-vous à la réception.',
    no_free_unit: 'Aucune chambre n’est libre pour le moment. Adressez-vous à la réception.',
    no_clean_unit: 'Votre chambre est encore en cours de nettoyage. Adressez-vous à la réception.',
    too_early: 'L’enregistrement est possible à partir de {time}.',
    balance_blocking: 'Un montant reste dû. Veuillez le régler à la réception.',
    not_found: 'Cette réservation est introuvable. Adressez-vous à la réception.',
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

/**
 * Слово з памʼяті екрана — до відомої мови.
 *
 * `fallback` називає ВИКЛИКАЧ, і це та сама правка, що в гостьовому
 * застосунку: німецька константою означала б, що термінал у чеському готелі
 * вітає чеха німецькою, бо так написано в коді (інваріант 20). Мову готелю
 * знає лише той, хто прочитав обʼєкт.
 */
export function kioskLang(value: unknown, fallback: KioskLang): KioskLang {
  return isLanguage(value) ? value : fallback;
}
