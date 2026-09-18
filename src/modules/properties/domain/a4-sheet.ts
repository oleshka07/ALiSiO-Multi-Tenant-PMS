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

/** Один мовний блок аркуша. */
export interface SheetBlock {
  lang: Language;
  headline: string;
  steps: readonly string[];
  note: string;
}

export interface SheetContent {
  hotelName: string;
  address: string;
  phone: string;
  /** Адреса, яку друкуємо текстом. Вона ж — вміст QR. */
  url: string;
  /** Те саме, окремим полем: гейт звіряє рівність, а не однаковість імені. */
  qrPayload: string;
  blocks: readonly SheetBlock[];
  /** Знак у шапці; порожньо — друкуємо саму назву. */
  logoUrl: string | null;
  /** Обкладинка; порожньо — аркуш без неї. */
  coverUrl: string | null;
  /** Дрібним у підвалі: чи цей аркуш іще чинний (КІ35). */
  keyTail: string;
  printedOn: string;
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
const SHEET_TEXT: Record<string, { headline: string; steps: string[]; note: string }> = {
  de: {
    headline: 'Scannen Sie den Code — und erledigen Sie alles vom Handy',
    steps: [
      'Freie Zimmer und Preise ansehen',
      'Ihre Buchung finden',
      'Ohne Warteschlange einchecken',
    ],
    note: 'Oder öffnen Sie die Adresse im Browser',
  },
  en: {
    headline: 'Scan the code — and do it all from your phone',
    steps: ['See free rooms and prices', 'Find your booking', 'Check in without queueing'],
    note: 'Or open the address in your browser',
  },
  cs: {
    headline: 'Naskenujte kód — a vyřiďte vše z telefonu',
    steps: ['Volné pokoje a ceny', 'Najít svou rezervaci', 'Odbavení bez čekání'],
    note: 'Nebo otevřete adresu v prohlížeči',
  },
  pl: {
    headline: 'Zeskanuj kod — i załatw wszystko z telefonu',
    steps: ['Wolne pokoje i ceny', 'Znajdź swoją rezerwację', 'Zamelduj się bez kolejki'],
    note: 'Albo otwórz adres w przeglądarce',
  },
  nl: {
    headline: 'Scan de code — en regel alles met uw telefoon',
    steps: ['Vrije kamers en prijzen', 'Uw boeking vinden', 'Inchecken zonder wachtrij'],
    note: 'Of open het adres in uw browser',
  },
  fr: {
    headline: 'Scannez le code — et faites tout depuis votre téléphone',
    steps: ['Chambres libres et tarifs', 'Retrouver votre réservation', 'Arrivée sans file d’attente'],
    note: 'Ou ouvrez l’adresse dans votre navigateur',
  },
  uk: {
    headline: 'Відскануйте код — і зробіть усе з телефона',
    steps: ['Вільні номери й ціни', 'Знайти свою бронь', 'Заселитись без черги'],
    note: 'Або відкрийте адресу в браузері',
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
  today: Date = new Date(),
): SheetContent {
  const url = sheetUrl(origin, property.guestAppKey);

  // Мова готелю першою, англійська другою — і НЕ двічі, коли готель
  // англомовний. Порядок не з реєстру навмисно: тут це не перелік мов
  // продукту, а «своя, потім спільна».
  const langs: Language[] = property.hotelLanguage === 'en'
    ? ['en']
    : [property.hotelLanguage, 'en'];

  const blocks: SheetBlock[] = langs.map((lang) => {
    const text = SHEET_TEXT[lang] ?? SHEET_TEXT.en;
    return {
      lang,
      // Власний заклик оператора йде ЛИШЕ в перший блок: він написав його
      // однією мовою, і продублювати його в англійський означало б надрукувати
      // те саме двічі, вдаючи переклад.
      headline: lang === langs[0] ? pick(overrides.headline, text.headline) : text.headline,
      steps: text.steps,
      note: lang === langs[0] ? pick(overrides.note, text.note) : text.note,
    };
  });

  return {
    hotelName: pick(overrides.hotelName, property.name),
    address: pick(overrides.address, [property.address, property.city].filter(Boolean).join(', ')),
    phone: pick(overrides.phone, property.phone),
    url,
    qrPayload: url,
    blocks,
    // Папір білий — тло світле завжди.
    logoUrl: logoFor(property.brand ?? {}, 'light'),
    coverUrl: property.brand?.cover ?? null,
    keyTail: property.guestAppKey.slice(-4),
    printedOn: today.toISOString().slice(0, 10),
  };
}
