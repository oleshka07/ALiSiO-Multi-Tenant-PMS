import { translateContent } from '@core/i18n/content-translations';
/* eslint-disable @typescript-eslint/no-explicit-any */
// ─── Booking Widget Locales ───

/**
 * Тут був `commonTranslations` — словник назв послуг ОДНОГО готелю
 * («Фінська сауна (2 години)», «Чан карпатський», «Виселення до 14:00 замість
 * 11:00») з перекладами на en/cs/de, продубльований трьома копіями.
 *
 * Дві причини прибрати. Він містив час заселення й тривалість послуг
 * конкретного кемпінгу — тобто чужі робочі дані у файлі платформи. І він був
 * ДРУГИМ словником того самого призначення: `@core/i18n/content-translations`
 * робить рівно це, на шість мов замість трьох, і саме там таким рядкам місце
 * (гейт `check-no-tenant-names` дозволяє його поіменно, бо ключі мусять
 * збігатися з тим, що вже лежить у рядках клієнта).
 *
 * Два словники одного призначення розходяться: цей знав «Сауна», а той —
 * «Сауна» і ще сорок зручностей, і яка з відповідей дійде до гостя, залежало
 * від того, який файл прочитали першим.
 */

export const tName = (obj: any, key: string, l: string): string => {
  if (!obj) return '';
  if (l === 'en' && obj[`${key}En`]) return obj[`${key}En`];
  if (l === 'cs' && obj[`${key}Cs`]) return obj[`${key}Cs`];
  if (l === 'de' && obj[`${key}De`]) return obj[`${key}De`];
  const baseVal = obj[key];
  // Один словник на весь продукт. Порожня відповідь означає «перекладу немає»,
  // і тоді показуємо як є — назву, яку ввів готель.
  return baseVal ? translateContent(baseVal, l) : baseVal;
};

export const v3Locales: Record<string, any> = {
  uk: {
    waitlistTitle: 'Список очікування',
    waitlistSub: 'Ми повідомимо вас, якщо ці дати звільняться.',
    subscribed: '✅ Ви підписалися!',
    yourEmail: 'Ваш email',
    subscribe: 'Підписатися',
    viewersNow: 'людей дивляться зараз',
    lastBooking: 'Остання бронь',
    occupancyNotice: 'У будиночку одне велике ліжко — ідеально для двох дорослих. Якщо з вами дитина, ми завжди раді зробити виняток: маленькі гості не займають окреме спальне місце 😊',
    chooseDatesPrice: 'Оберіть дати щоб дізнатись ціну',
    tryTheseDates: '💡 Спробуйте ці дати:',
    availFrom: 'Вільні місця з',
    offerError: 'Недійсний промокод',
    serverError: 'Помилка підключення',
    errorReq: 'Будь ласка, заповніть всі необхідні поля',
    clear: 'Стерти',
    fromTime: 'з', optionsAvailable: 'варіантів', fromPrice: 'від',
    toTime: 'до',
    chooseDatesShort: 'обрати дати',
    bankTransfer: 'Оплата за реквізитами',
    bankTransferDesc: 'Ми надішлемо вам реквізити для оплати на email одразу після підтвердження бронювання.',
    checkDetails: 'Перевірте деталі та продовжуйте бронювання',
    fromTimeBase: 'від',
    nightBase: 'ніч',
    agoHours: 'годин тому',
    agoHour: 'годину тому',
    agoMinutes: 'хвилин тому',
    connectionError: 'Помилка підключення',
  },
  en: {
    waitlistTitle: 'Waitlist',
    waitlistSub: 'We will notify you if these dates become available.',
    subscribed: '✅ Subscribed!',
    yourEmail: 'Your email',
    subscribe: 'Subscribe',
    viewersNow: 'people looking right now',
    lastBooking: 'Last booking',
    occupancyNotice: 'The house has one large bed — ideal for two adults. If you have a child with you, we are happy to make an exception: young guests do not occupy a separate bed 😊',
    chooseDatesPrice: 'Select dates to see price',
    tryTheseDates: '💡 Try these dates:',
    availFrom: 'Available from',
    offerError: 'Invalid Coupon code',
    serverError: 'Connection error',
    errorReq: 'Please fill in all required fields',
    clear: 'Clear',
    fromTime: 'from', optionsAvailable: 'options', fromPrice: 'from',
    toTime: 'until',
    chooseDatesShort: 'select dates',
    bankTransfer: 'Bank Transfer',
    bankTransferDesc: 'We will email you the payment details immediately after confirming the booking.',
    checkDetails: 'Check details and continue booking',
    fromTimeBase: 'from',
    nightBase: 'night',
    agoHours: 'hours ago',
    agoHour: 'hour ago',
    agoMinutes: 'minutes ago',
    connectionError: 'Connection error',
  },
  cs: {
    waitlistTitle: 'Čekací listina',
    waitlistSub: 'Dáme vám vědět, pokud se tyto termíny uvolní.',
    subscribed: '✅ Přihlášeno!',
    yourEmail: 'Váš email',
    subscribe: 'Odebírat',
    viewersNow: 'lidé si právě prohlížejí',
    lastBooking: 'Poslední rezervace',
    occupancyNotice: 'Dům má jednu velkou postel — ideální pro dva dospělé. Pokud s sebou máte dítě, rádi uděláme výjimku: malí hosté nezabírají samostatné lůžko 😊',
    chooseDatesPrice: 'Vyberte termíny pro zobrazení ceny',
    tryTheseDates: '💡 Zkuste tyto termíny:',
    availFrom: 'Volné od',
    offerError: 'Neplatný offer kód',
    serverError: 'Chyba připojení',
    errorReq: 'Vyplňte prosím všechna povinná pole',
    clear: 'Smazat',
    fromTime: 'od', optionsAvailable: 'možností', fromPrice: 'od',
    toTime: 'do',
    chooseDatesShort: 'vybrat termíny',
    bankTransfer: 'Bankovní převod',
    bankTransferDesc: 'Platební údaje vám zašleme e-mailem ihned po potvrzení rezervace.',
    checkDetails: 'Zkontrolujte detaily a pokračujte v rezervaci',
    fromTimeBase: 'od',
    nightBase: 'noc',
    agoHours: 'před hodinami',
    agoHour: 'před hodinou',
    agoMinutes: 'před minutami',
    connectionError: 'Chyba připojení',
  },
  de: {
    waitlistTitle: 'Warteliste',
    waitlistSub: 'Wir benachrichtigen Sie, falls diese Daten verfügbar werden.',
    subscribed: '✅ Abonniert!',
    yourEmail: 'Ihre E-Mail',
    subscribe: 'Abonnieren',
    viewersNow: 'Personen sehen sich das gerade an',
    lastBooking: 'Letzte Buchung',
    occupancyNotice: 'Das Haus hat ein großes Bett — ideal für zwei Erwachsene. Wenn Sie ein Kind dabei haben, machen wir gerne eine Ausnahme: kleine Gäste belegen kein separates Bett 😊',
    chooseDatesPrice: 'Wählen Sie Daten aus, um den Preis zu sehen',
    tryTheseDates: '💡 Versuchen Sie diese Daten:',
    availFrom: 'Verfügbar ab',
    offerError: 'Ungültiger Promo-Code',
    serverError: 'Verbindungsfehler',
    errorReq: 'Bitte füllen Sie alle erforderlichen Felder aus',
    clear: 'Löschen',
    fromTime: 'ab', optionsAvailable: 'Optionen', fromPrice: 'ab',
    toTime: 'bis',
    chooseDatesShort: 'Daten auswählen',
    bankTransfer: 'Banküberweisung',
    bankTransferDesc: 'Wir senden Ihnen die Zahlungsdetails sofort nach Bestätigung der Buchung per E-Mail zu.',
    checkDetails: 'Überprüfen Sie die Details und setzen Sie die Buchung fort',
    fromTimeBase: 'ab',
    nightBase: 'Nacht',
    agoHours: 'Stunden her',
    agoHour: 'Stunde her',
    agoMinutes: 'Minuten her',
    connectionError: 'Verbindungsfehler',
  },
};
