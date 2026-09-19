/**
 * Що написано на аркуші A4 з QR — ЗМІСТ, окремо від малювання.
 *
 * ── Чому змістом, а не одразу в PDF ─────────────────────────────────────
 *
 * Бо твердження, яке тут найважливіше, про ЗМІСТ, а не про картинку:
 * **адреса в QR-коді дорівнює адресі, надрукованій під ним**. Код, що веде
 * не туди, куди вказує підпис, — тиха помилка: сторінка відкриється, просто
 * не та, і побачить це гість, а не ми.
 *
 * Розібрати це з готового PDF означало б розтеризувати сторінку. Тут воно
 * читається просто, а `a4-sheet.check` ще й РОЗКОДОВУЄ згенерований QR
 * назад (`jsqr`) і звіряє з рядком — тобто перевіряється не «ми попросили
 * закодувати правильне», а «у коді лежить правильне».
 *
 * ── Дані готелю проти правок оператора ──────────────────────────────────
 *
 * Дефолти — з рядка обʼєкта (назва, адреса, місто, телефон). Оператор може
 * замінити будь-яке поле перед друком: телефон рецепції часто не той, що
 * загальний у картці обʼєкта. Правки РАЗОВІ (рішення власника 18.09): вони
 * живуть у вікні друку й нікуди не зберігаються — тож жодної колонки тут
 * немає й міграція не потрібна.
 *
 * Порожня правка означає «лиши як у готелю», а не «зітри»: форма шле всі
 * поля завжди, і без цього правила порожній рядок у полі телефону прибрав би
 * телефон з аркуша (той самий клас, що `property_type: ''` у формі обʼєкта).
 *
 * ── Мови ────────────────────────────────────────────────────────────────
 *
 * Дві: мова готелю і англійська (рішення власника 18.09). Не сім — застосунок
 * за QR-кодом бере мову з телефона сам (КІ20), і повторювати цю роботу на
 * папері означало б дрібний шрифт, якого не читає ніхто. Якщо мова готелю і
 * є англійська, другої немає: один блок замість двох однакових.
 */
import { logoFor, type BrandAssets } from '@core/brand-assets.ts';
import { whatsappLink } from '../data/reception.repo.ts';
import { type Language } from '@core/i18n/languages.ts';

/** Те, що збирач знає про обʼєкт. Рівно колонки `properties` + мова готелю. */
export interface SheetProperty {
  name: string;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  guestAppKey: string;
  hotelLanguage: Language;
  /**
   * Зображення обʼєкта за ролями (0421). Аркуш читає дві:
   *
   *   `logo` — знак у шапці. Немає — друкуємо НАЗВУ текстом: назва є завжди,
   *     а порожній прямокутник гірший за слово (той самий довід, що в 0419);
   *   `cover` — фасад або загальний вигляд. Немає — аркуш просто без нього,
   *     і це не гірший аркуш, а інший: QR від цього не меншає.
   *
   * `logo_light` тут НЕ читається навмисно: аркуш друкують на білому папері,
   * тож тло завжди світле. Роль існує для темних палітр на екрані.
   */
  brand?: BrandAssets;
  /** Години, коли на телефон рецепції відповідають (0422). Порожньо — не друкуємо. */
  receptionHours?: string | null;
  /**
   * Окремий номер для чату, якщо готель його НАЗВАВ. Порожньо — чат іде на
   * той номер, що друкується на аркуші (див. `buildSheet`).
   */
  whatsappPhone?: string | null;
  /** Хто відповість — друкується поруч із номером (0423). */
  receptionName?: string | null;
}

/** Що оператор поправив у вікні друку. Порожнє поле = «як у готелю». */
export interface SheetOverrides {
  hotelName?: string;
  address?: string;
  phone?: string;
  /** Власний заклик замість нашого. Порожньо — беремо свій, двома мовами. */
  headline?: string;
  note?: string;
}

/**
 * Одна КОЛОНКА аркуша — одна мова.
 *
 * Спершу мови йшли рядками одна під одною, і власник другої на аркуші
 * просто НЕ ПОБАЧИВ: англійський текст читався як дрібна примітка під
 * німецьким, а не як «те саме іншою мовою». Колонка з підписом мови
 * зверху каже це формою, без жодного пояснення — гість знаходить свою
 * мову за секунду й не читає чужу.
 */
export interface SheetBlock {
  lang: Language;
  /** Підпис колонки — РІДНОЮ назвою мови: гість шукає слово, яке впізнає. */
  langName: string;
  /** Перший рядок, жирним: що взагалі зробити. */
  lead: string;
  /** Дві розвилки: бронь уже є / броні немає. Кожна — назва плюс дія. */
  bullets: readonly { label: string; text: string }[];
  /** Тихий хвіст: що буде далі. */
  tail: string;
}

export interface SheetContent {
  hotelName: string;
  address: string;
  phone: string;
  /** Велика дія вгорі, мовою готелю. Те, заради чого аркуш висить. */
  title: string;
  /** Під нею — та сама дія рештою мов аркуша, через крапку. */
  subtitle: string;
  /** «Потрібна допомога?» всіма мовами аркуша — підпис над телефоном. */
  helpLabel: string;
  /** Кого саме набирають. Без годин: ми їх не знаємо і не вигадуємо. */
  helpRole: string;
  /** Нижній рядок: підготуйте документ — усіма мовами аркуша. */
  idNote: string;
  /** Адреса, яку друкуємо текстом. Вона ж — вміст QR. */
  url: string;
  /** Те саме, окремим полем: гейт звіряє рівність, а не однаковість імені. */
  qrPayload: string;
  blocks: readonly SheetBlock[];
  /** Знак у шапці; порожньо — друкуємо саму назву. */
  logoUrl: string | null;
  /** Обкладинка; порожньо — аркуш без неї. */
  coverUrl: string | null;
  /**
   * Години рецепції — рядок ГОТЕЛЮ, не наш переказ (0422).
   *
   * Порожньо — під телефоном їх просто немає. Підставити «цілодобово» тому,
   * що поле порожнє, означало б надрукувати обіцянку, якої готель не давав.
   */
  hours: string | null;
  /**
   * Другий QR — чат WhatsApp. Порожньо, коли номера немає або в ньому
   * замало цифр: код, що веде на сторінку помилки, гірший за порожнє місце.
   */
  whatsappUrl: string | null;
  /** Хто відповість. Порожньо — рядок просто без імені. */
  helpName: string | null;
}

/**
 * Тексти аркуша.
 *
 * Тут вони літералами, і це НЕ порушення інваріанта 20: це наші слова, не
 * дані готелю — так само, як підпис кнопки. Але й не `t()`: `t()` перекладає
 * мовою ОПЕРАТОРА, а тут потрібні дві конкретні мови одночасно, і жодна з
 * них не залежить від того, хто натиснув кнопку (інваріант 19 за духом —
 * документ говорить мовою того, хто його читає, а читає гість).
 *
 * Готель, якому наші слова не підходять, пише свої у вікні друку.
 */
interface SheetWords {
  /** Рідна назва мови — підпис колонки. */
  langName: string;
  /** Велика дія вгорі. Капс робить малювач, не ми. */
  title: string;
  /** Коротка та сама дія — для рядка підзаголовка з іншими мовами. */
  short: string;
  lead: string;
  withBooking: { label: string; text: string };
  noBooking: { label: string; text: string };
  tail: string;
  help: string;
  role: string;
  idNote: string;
}

const SHEET_TEXT: Record<string, SheetWords> = {
  de: {
    langName: 'Deutsch',
    title: 'Selbst-Check-in',
    short: 'Selbst-Check-in',
    lead: 'Scannen Sie den QR-Code mit dem Handy.',
    withBooking: { label: 'Mit Reservierung:', text: 'über Ihren Namen finden und einchecken.' },
    noBooking: { label: 'Ohne Reservierung:', text: 'freies Zimmer wählen und sofort buchen.' },
    tail: 'Danach erhalten Sie eine Bestätigung und Anreisehinweise.',
    help: 'Brauchen Sie Hilfe?',
    role: 'Rezeption',
    idNote: 'Bitte halten Sie Ihren Ausweis bereit',
  },
  en: {
    langName: 'English',
    title: 'Self check-in',
    short: 'Self-service check-in',
    lead: 'Scan the QR code with your phone.',
    withBooking: { label: 'I have a booking:', text: 'find it by your name and check in.' },
    noBooking: { label: 'No booking yet:', text: 'pick a free room and book it right away.' },
    tail: 'You will then receive a confirmation and arrival instructions.',
    help: 'Need help?',
    role: 'Reception',
    idNote: 'Please have your ID or passport ready',
  },
  cs: {
    langName: 'Čeština',
    title: 'Samoobslužné přihlášení',
    short: 'Samoobslužné přihlášení',
    lead: 'Naskenujte QR kód telefonem.',
    withBooking: { label: 'Mám rezervaci:', text: 'najděte ji podle jména a dokončete přihlášení.' },
    noBooking: { label: 'Nemám rezervaci:', text: 'vyberte volný pokoj a rovnou jej rezervujte.' },
    tail: 'Poté obdržíte potvrzení a pokyny k ubytování.',
    help: 'Potřebujete pomoc?',
    role: 'Recepce',
    idNote: 'Připravte si prosím doklad totožnosti',
  },
  pl: {
    langName: 'Polski',
    title: 'Samodzielne zameldowanie',
    short: 'Samodzielne zameldowanie',
    lead: 'Zeskanuj kod QR telefonem.',
    withBooking: { label: 'Mam rezerwację:', text: 'znajdź ją po nazwisku i zamelduj się.' },
    noBooking: { label: 'Nie mam rezerwacji:', text: 'wybierz wolny pokój i zarezerwuj od razu.' },
    tail: 'Następnie otrzymasz potwierdzenie i wskazówki dojazdu.',
    help: 'Potrzebujesz pomocy?',
    role: 'Recepcja',
    idNote: 'Prosimy przygotować dokument tożsamości',
  },
  nl: {
    langName: 'Nederlands',
    title: 'Zelf inchecken',
    short: 'Zelf inchecken',
    lead: 'Scan de QR-code met uw telefoon.',
    withBooking: { label: 'Met boeking:', text: 'zoek hem op uw naam en check in.' },
    noBooking: { label: 'Zonder boeking:', text: 'kies een vrije kamer en boek meteen.' },
    tail: 'Daarna ontvangt u een bevestiging en aankomstinformatie.',
    help: 'Hulp nodig?',
    role: 'Receptie',
    idNote: 'Houd uw identiteitsbewijs gereed',
  },
  fr: {
    langName: 'Français',
    title: 'Enregistrement autonome',
    short: 'Enregistrement autonome',
    lead: 'Scannez le QR code avec votre téléphone.',
    withBooking: { label: 'J’ai une réservation :', text: 'retrouvez-la par votre nom et enregistrez-vous.' },
    noBooking: { label: 'Pas de réservation :', text: 'choisissez une chambre libre et réservez aussitôt.' },
    tail: 'Vous recevrez ensuite une confirmation et les informations d’arrivée.',
    help: 'Besoin d’aide ?',
    role: 'Réception',
    idNote: 'Merci de préparer votre pièce d’identité',
  },
  uk: {
    langName: 'Українська',
    title: 'Самостійне заселення',
    short: 'Самостійне заселення',
    lead: 'Відскануйте QR-код телефоном.',
    withBooking: { label: 'Маю бронь:', text: 'знайдіть її за іменем і завершіть заселення.' },
    noBooking: { label: 'Броні немає:', text: 'оберіть вільний номер і забронюйте одразу.' },
    tail: 'Далі отримаєте підтвердження і вказівки до заїзду.',
    help: 'Потрібна допомога?',
    role: 'Рецепція',
    idNote: 'Підготуйте, будь ласка, документ',
  },
};

/** Порожнє поле правки означає «як у готелю», а не «зітри». */
const pick = (override: string | undefined, fromHotel: string | null | undefined): string => {
  const edited = (override ?? '').trim();
  return edited || (fromHotel ?? '').trim();
};

/**
 * Адреса, на яку веде QR. `origin` приходить від викликача, бо на беті й на
 * проді він різний, а вгадати його з коду не можна.
 */
export function sheetUrl(origin: string, guestAppKey: string): string {
  return `${origin.replace(/\/+$/, '')}/stay/${guestAppKey}`;
}

export function buildSheet(
  property: SheetProperty,
  origin: string,
  overrides: SheetOverrides = {},
): SheetContent {
  const url = sheetUrl(origin, property.guestAppKey);

  // Мова готелю першою, англійська другою — і НЕ двічі, коли готель
  // англомовний. Порядок не з реєстру навмисно: тут це не перелік мов
  // продукту, а «своя, потім спільна».
  const langs: Language[] = property.hotelLanguage === 'en'
    ? ['en']
    : [property.hotelLanguage, 'en'];

  const words = (lang: Language): SheetWords => SHEET_TEXT[lang] ?? SHEET_TEXT.en;
  const first = words(langs[0]);

  const blocks: SheetBlock[] = langs.map((lang) => {
    const text = words(lang);
    return {
      lang,
      langName: text.langName,
      // Власний заклик оператора йде ЛИШЕ в першу колонку: він написав його
      // однією мовою, і продублювати його в англійську означало б надрукувати
      // те саме двічі, вдаючи переклад.
      lead: lang === langs[0] ? pick(overrides.headline, text.lead) : text.lead,
      bullets: [text.withBooking, text.noBooking],
      tail: lang === langs[0] ? pick(overrides.note, text.tail) : text.tail,
    };
  });

  // Рядки, що збирають УСІ мови аркуша в один — як у зразку кемпінгу.
  // Дублікати прибираються: готель, чия мова англійська, має один блок, і
  // «Self check-in · Self check-in» виглядало б як помилка друку.
  const joinAll = (take: (w: SheetWords) => string): string =>
    [...new Set(langs.map((l) => take(words(l))))].join(' · ');

  return {
    hotelName: pick(overrides.hotelName, property.name),
    address: pick(overrides.address, [property.address, property.city].filter(Boolean).join(', ')),
    phone: pick(overrides.phone, property.phone),
    url,
    qrPayload: url,
    title: first.title,
    // Підзаголовок — РЕШТА мов, без першої: заголовок уже сказав її великим
    // кеглем, і «SELBST-CHECK-IN / Selbst-Check-in · Self-service check-in»
    // читається як помилка друку, а не як дві мови. Одна мова на аркуші →
    // рядок порожній, і малювач його не друкує.
    subtitle: [...new Set(langs.slice(1).map((l) => words(l).short))].join(' · '),
    helpLabel: joinAll((w) => w.help),
    helpRole: joinAll((w) => w.role),
    idNote: joinAll((w) => w.idNote),
    blocks,
    // Папір білий — тло світле завжди.
    logoUrl: logoFor(property.brand ?? {}, 'light'),
    coverUrl: property.brand?.cover ?? null,
    hours: (property.receptionHours ?? '').trim() || null,
    helpName: (property.receptionName ?? '').trim() || null,
    // ── Чат іде на ТОЙ номер, що надрукований ────────────────────────────
    //
    // Доти код будувався лише з окремого поля «WhatsApp гостьової сторінки»,
    // а великим кеглем друкувався зовсім інший номер — телефон обʼєкта або
    // правка оператора у вікні друку. Власник ввів номер у вікні друку,
    // побачив його на аркуші й НЕ побачив коду: два поля, одна підпис.
    //
    // Тепер: названий окремо номер чату виграє (готель міг дати мобільний
    // саме для чату), а якщо його немає — чат веде на надрукований номер.
    // Інакше поруч стояли б код і підпис, що ведуть на різні номери, — рівно
    // той клас, що адреса під кодом, який вів не туди.
    //
    // Ціна названа: якщо надрукований номер стаціонарний, код відкриє
    // WhatsApp і той скаже «номера немає в WhatsApp». Це видно одразу при
    // першій перевірці телефоном, на відміну від мовчазної відсутності коду.
    whatsappUrl: whatsappLink(
      (property.whatsappPhone ?? '').trim() || pick(overrides.phone, property.phone)),
  };
}
