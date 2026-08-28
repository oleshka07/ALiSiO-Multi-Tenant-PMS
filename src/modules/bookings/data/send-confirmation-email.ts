/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Booking confirmation email — fired once per reservation when payment lands
 * (Teya webhook or admin-PIN). Idempotency is the caller's job: only call
 * after a payment_status update where `.changes > 0` so we don't email twice.
 *
 * This is the first letter a guest gets, and until now it was the same letter
 * for everybody: English text, dates formatted `uk-UA`, and a closing signed
 * with one person's name describing "a hot tub under the stars". A German
 * guest booking a German hotel was welcomed in English, by a stranger, to
 * something the hotel does not have. The reminder and the abandoned-cart
 * letters had already been taught to use `reservationLanguage()`; this one had
 * not, and it is the one that goes out first.
 *
 * Two rules follow from that, and they are the same rule twice:
 *
 *   the language is the GUEST's        reservationLanguage(), never the
 *                                      operator's and never the product's
 *   the voice is the PROPERTY's        the hotel's own copy comes from
 *                                      widget_config; the default says only
 *                                      what is true of every hotel
 *
 * The hotel that wants poetry in its confirmation writes it in
 * `email_confirmed_body`, where it belongs to that hotel and travels with it.
 * Nothing here may be true of one customer only.
 */
import { getSql } from '@core/db/async';
import { organizationCurrency } from '@core/currency';
import { appBaseUrl } from '@core/app-url';
import { sendEmail } from '@core/mail/email';
import { reservationLanguage } from '@core/i18n/resolve';

/** Only four letters are written; anything else lands on English, not on half of one. */
type LetterLanguage = 'en' | 'uk' | 'de' | 'cs';

const LOCALE: Record<LetterLanguage, string> = {
  en: 'en-GB', uk: 'uk-UA', de: 'de-DE', cs: 'cs-CZ',
};

function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  } catch { return iso; }
}

/**
 * The amount in the guest's own reading of it.
 *
 * `Intl` with the currency code, not a number glued to a string: 1 234,50 €
 * in German and €1,234.50 in English are the same amount, and a guest who has
 * to parse the punctuation is a guest who writes to ask what they paid.
 */
function fmtPrice(n: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)} ${currency}`;
  }
}

interface Letter {
  guest: string;
  subjectPaid: string;
  subjectUnpaid: string;
  headingPaid: string;
  headingUnpaid: string;
  greeting: (name: string) => string;
  thanks: (property: string) => string;
  statusPaid: string;
  statusUnpaid: string;
  btnPage: string;
  btnPay: string;
  pageHintPaid: string;
  pageHintUnpaid: string;
  signOff: string;
  bookingId: string;
  accommodation: string;
  checkIn: string;
  checkOut: string;
  nights: string;
  guests: string;
  children: string;
  paid: string;
  total: string;
  help: string;
}

/**
 * The default letter, in four languages.
 *
 * Every sentence here has to be true of a mountain cabin, a city hotel and a
 * campsite alike, because all three send it. "Photos of the cabin" was not,
 * and neither was the hot tub. What is left says only what the product
 * actually guarantees: the booking, the dates, the amount, and a link to a
 * page the hotel filled in itself.
 */
const LETTER: Record<LetterLanguage, Letter> = {
  en: {
    guest: 'Guest',
    subjectPaid: 'Booking confirmed',
    subjectUnpaid: 'Action required: complete your booking',
    headingPaid: 'Booking confirmed',
    headingUnpaid: 'Booking registered',
    greeting: (n) => `Hello ${n},`,
    thanks: (p) => `Thank you for booking with ${p}. Here are your details.`,
    statusPaid: 'Your booking is confirmed and your payment has been received.',
    statusUnpaid: 'Your booking is registered. To secure your dates, please complete your payment.',
    btnPage: 'Open guest page →',
    btnPay: 'Go to payment →',
    pageHintPaid: 'On your guest page you will find how to get here, what is included, and everything you can arrange before arrival.',
    pageHintUnpaid: 'After payment your guest page will open — with how to get here, what is included, and everything you can arrange before arrival.',
    signOff: 'See you soon,',
    bookingId: 'Booking ID',
    accommodation: 'Accommodation',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    nights: 'Nights',
    guests: 'Guests',
    children: 'child',
    paid: 'Paid',
    total: 'Total',
    help: 'Need help? WhatsApp',
  },
  de: {
    guest: 'Gast',
    subjectPaid: 'Buchung bestätigt',
    subjectUnpaid: 'Bitte abschließen: Ihre Buchung',
    headingPaid: 'Buchung bestätigt',
    headingUnpaid: 'Buchung eingegangen',
    greeting: (n) => `Guten Tag ${n},`,
    thanks: (p) => `vielen Dank für Ihre Buchung im ${p}. Hier sind Ihre Daten.`,
    statusPaid: 'Ihre Buchung ist bestätigt und Ihre Zahlung ist bei uns eingegangen.',
    statusUnpaid: 'Ihre Buchung ist eingegangen. Bitte schließen Sie die Zahlung ab, damit wir Ihre Termine verbindlich reservieren können.',
    btnPage: 'Gästeseite öffnen →',
    btnPay: 'Zur Zahlung →',
    pageHintPaid: 'Auf Ihrer Gästeseite finden Sie die Anfahrt, die enthaltenen Leistungen und alles, was Sie schon vor der Anreise erledigen können.',
    pageHintUnpaid: 'Nach der Zahlung öffnet sich Ihre Gästeseite — mit der Anfahrt, den enthaltenen Leistungen und allem, was Sie schon vor der Anreise erledigen können.',
    signOff: 'Wir freuen uns auf Sie,',
    bookingId: 'Buchungsnummer',
    accommodation: 'Unterkunft',
    checkIn: 'Anreise',
    checkOut: 'Abreise',
    nights: 'Nächte',
    guests: 'Gäste',
    children: 'Kind',
    paid: 'Bezahlt',
    total: 'Gesamt',
    help: 'Fragen? WhatsApp',
  },
  uk: {
    guest: 'Гість',
    subjectPaid: 'Бронювання підтверджено',
    subjectUnpaid: 'Залишилось оплатити: ваше бронювання',
    headingPaid: 'Бронювання підтверджено',
    headingUnpaid: 'Бронювання прийнято',
    greeting: (n) => `Доброго дня, ${n}!`,
    thanks: (p) => `Дякуємо за бронювання у ${p}. Ось ваші деталі.`,
    statusPaid: 'Бронювання підтверджене, оплату отримано.',
    statusUnpaid: 'Бронювання прийняте. Щоб закріпити дати, завершіть оплату.',
    btnPage: 'Відкрити сторінку гостя →',
    btnPay: 'Перейти до оплати →',
    pageHintPaid: 'На сторінці гостя — як дістатися, що входить у ціну і що можна замовити ще до приїзду.',
    pageHintUnpaid: 'Після оплати відкриється сторінка гостя — як дістатися, що входить у ціну і що можна замовити ще до приїзду.',
    signOff: 'До зустрічі,',
    bookingId: 'Номер бронювання',
    accommodation: 'Помешкання',
    checkIn: 'Заїзд',
    checkOut: 'Виїзд',
    nights: 'Ночей',
    guests: 'Гостей',
    children: 'дит.',
    paid: 'Оплачено',
    total: 'Разом',
    help: 'Питання? WhatsApp',
  },
  cs: {
    guest: 'Host',
    subjectPaid: 'Rezervace potvrzena',
    subjectUnpaid: 'Zbývá dokončit: vaše rezervace',
    headingPaid: 'Rezervace potvrzena',
    headingUnpaid: 'Rezervace přijata',
    greeting: (n) => `Dobrý den ${n},`,
    thanks: (p) => `děkujeme za rezervaci v ${p}. Zde jsou vaše údaje.`,
    statusPaid: 'Vaše rezervace je potvrzena a platbu jsme obdrželi.',
    statusUnpaid: 'Vaše rezervace je přijata. Pro závazné podržení termínu prosím dokončete platbu.',
    btnPage: 'Otevřít stránku hosta →',
    btnPay: 'Přejít k platbě →',
    pageHintPaid: 'Na stránce hosta najdete, jak se k nám dostat, co je v ceně a co si můžete zařídit ještě před příjezdem.',
    pageHintUnpaid: 'Po platbě se otevře stránka hosta — jak se k nám dostat, co je v ceně a co si můžete zařídit ještě před příjezdem.',
    signOff: 'Těšíme se na vás,',
    bookingId: 'Číslo rezervace',
    accommodation: 'Ubytování',
    checkIn: 'Příjezd',
    checkOut: 'Odjezd',
    nights: 'Nocí',
    guests: 'Hostů',
    children: 'dítě',
    paid: 'Zaplaceno',
    total: 'Celkem',
    help: 'Dotazy? WhatsApp',
  },
};

export async function sendBookingConfirmationEmail(reservationId: string, origin?: string): Promise<boolean> {
  const sql = getSql();

  // `u.thank_you_url` used to be in this list and does not exist: the column
  // is on site_listings. So the FIRST query of the confirmation letter threw
  // for every booking, on both engines, and the caller read the failure as a
  // plain `false`. Nothing had ever read the value either.
  const row = await sql.row<any>(`
    SELECT r.id, r.unit_id, r.check_in, r.check_out, r.nights, r.adults, r.children,
           r.total_price, r.currency, r.guest_page_token, r.payment_status,
           g.first_name, g.last_name, g.email,
           u.name as unit_name,
           p.name as property_name, p.phone as property_phone, p.organization_id
    FROM reservations r
    LEFT JOIN guests g ON r.guest_id = g.id
    LEFT JOIN units u ON r.unit_id = u.id
    LEFT JOIN properties p ON r.property_id = p.id
    WHERE r.id = ?
  `, [reservationId]) as any;

  if (!row) {
    console.warn(`[BookingEmail] Reservation ${reservationId} not found`);
    return false;
  }

  if (!row.email) {
    console.log(`[BookingEmail] No email on reservation ${reservationId} — skipping`);
    return false;
  }

  // What the guest told us — their own choice, else the language they booked
  // in, else their country. Never the receptionist's interface.
  const spoken = await reservationLanguage(reservationId);
  const lang: LetterLanguage = (['uk', 'de', 'cs'] as const).includes(spoken as any)
    ? (spoken as LetterLanguage)
    : 'en';
  const locale = LOCALE[lang];
  const L = LETTER[lang];

  const guestName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || L.guest;
  /**
   * Валюта листа.
   *
   * Тут стояло два різні запасні значення в ОДНОМУ файлі: форматувальник брав
   * `currency || 'EUR'`, а виклик нижче передавав `row.currency || 'CZK'`. Тобто
   * та сама сума в тому самому листі могла отримати два різні підписи залежно
   * від того, який із двох запасних спрацював.
   *
   * Запасного немає. Валюта броні, а якщо її немає — валюта готелю, який цей
   * лист шле. Обидва значення завжди відомі: `row` уже несе `organization_id`,
   * бо лист і так іде зі скриньки цього готеля.
   */
  const currency = row.currency || await organizationCurrency(row.organization_id);
  const total = fmtPrice(row.total_price || 0, currency, locale);
  let guestPageUrl = null;
  if (row.guest_page_token) {
    const baseUrl = appBaseUrl();
    guestPageUrl = `${baseUrl}/guest/${row.guest_page_token}`;
  }

  let widgetConfig: any = {};
  if (row.unit_id) {
    try {
      // `sl.is_active` was in this WHERE and site_listings has no such column,
      // on either engine. The query threw every time, the catch below logged
      // it, and the letter fell back to the default text — so a hotel that had
      // written its own confirmation body never saw it sent. The site's own
      // status is the real question, and booking_sites answers it — the same
      // `<> 'deleted'` every widget handler uses, because a paused site's
      // configuration is still that hotel's configuration.
      const siteRow = await sql.row<any>(`
        SELECT bs.widget_config FROM site_listings sl
        JOIN booking_sites bs ON sl.site_id = bs.id
        WHERE sl.unit_id = ? AND bs.status <> 'deleted'
        LIMIT 1
      `, [row.unit_id]) as any;
      if (siteRow?.widget_config) {
        widgetConfig = JSON.parse(siteRow.widget_config);
      }
    } catch (e: any) {
      console.error('[BookingEmail] Failed to fetch site widget_config:', e.message);
    }
  }

  const propertyName = row.property_name || 'ALiSiO';
  const propertyPhone = row.property_phone || '';
  const isPaid = row.payment_status === 'paid' || row.payment_status === 'prepaid';

  const replaceDict: Record<string, string> = {
    propertyName,
    bookingId: row.id,
    guestName,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    checkIn: fmtDate(row.check_in, locale),
    checkOut: fmtDate(row.check_out, locale),
    nights: String(row.nights || 1),
    totalPrice: total,
    unitName: row.unit_name || '—'
  };

  const replacePlaceholders = (tpl: string, dict: Record<string, string>) => {
    let str = tpl;
    for (const [k, v] of Object.entries(dict)) {
      str = str.split(`{${k}}`).join(v);
    }
    return str;
  };

  const defaultSubject = isPaid
    ? `${L.subjectPaid} — ${propertyName} #${row.id}`
    : `${L.subjectUnpaid} — ${propertyName}`;

  const rawSubject = isPaid
    ? (widgetConfig.email_confirmed_subject || defaultSubject)
    : (widgetConfig.email_unpaid_subject || defaultSubject);

  const subject = replacePlaceholders(rawSubject, replaceDict);
  
  const rawBody = isPaid
    ? widgetConfig.email_confirmed_body
    : widgetConfig.email_unpaid_body;
  const customMessage = rawBody ? replacePlaceholders(rawBody, replaceDict) : null;

  const totalLabel = isPaid ? L.paid : L.total;
  const guests = `${row.adults || 1}${row.children ? ` + ${row.children} ${L.children}` : ''}`;

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto;padding:24px;background:#f7f7f9;">
  <div style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 16px rgba(0,0,0,0.04);">
    <div style="font-size:28px;color:#2E6B4F;font-weight:700;margin-bottom:8px;">${propertyName}</div>
    <div style="font-size:14px;color:#666;margin-bottom:24px;">${isPaid ? L.headingPaid : L.headingUnpaid}</div>

    <p style="font-size:16px;margin:0 0 16px;">${L.greeting(guestName)}</p>

    ${customMessage ? `
      <div style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#444;white-space:pre-wrap;">${customMessage}</div>
    ` : `
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#444;">
        ${L.thanks(propertyName)}
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#444;font-weight:600;">
        ${isPaid ? L.statusPaid : L.statusUnpaid}
      </p>
    `}

    ${guestPageUrl ? `
    <div style="margin-bottom:24px;">
      <a href="${guestPageUrl}" style="display:inline-block;background:#2E6B4F;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;font-size:15px;box-shadow:0 2px 4px rgba(46,107,79,0.2);">
        ${L.btnPage}
      </a>
    </div>` : ''}

    <p style="font-size:14px;line-height:1.6;margin:0 0 24px;color:#555;">
      ${L.pageHintPaid}
    </p>

    <p style="font-size:15px;line-height:1.6;margin:0 0 32px;color:#444;">
      ${L.signOff}<br>
      ${propertyName}
    </p>

    <div style="background:#f0f9f4;border:1px solid #d4e9da;border-radius:12px;padding:16px 18px;margin:20px 0;">
      <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">${L.bookingId}</div>
      <div style="font-size:20px;font-weight:700;color:#2E6B4F;margin-top:2px;">${row.id}</div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#666;">${L.accommodation}</td><td style="text-align:right;font-weight:600;">${row.unit_name || '—'}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">${L.checkIn}</td><td style="text-align:right;font-weight:600;">${fmtDate(row.check_in, locale)}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">${L.checkOut}</td><td style="text-align:right;font-weight:600;">${fmtDate(row.check_out, locale)}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">${L.nights}</td><td style="text-align:right;font-weight:600;">${row.nights || '—'}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">${L.guests}</td><td style="text-align:right;font-weight:600;">${guests}</td></tr>
      <tr><td style="padding:12px 0 0;color:#2E6B4F;font-size:15px;"><strong>${totalLabel}</strong></td><td style="text-align:right;padding:12px 0 0;color:#2E6B4F;font-weight:700;font-size:15px;">${total}</td></tr>
    </table>

    <hr style="border:none;border-top:1px solid #eee;margin:28px 0 16px;">
    <div style="font-size:13px;color:#777;line-height:1.5;">
      ${propertyPhone ? `${L.help} <a href="https://wa.me/${propertyPhone.replace(/[^0-9]/g, '')}" style="color:#2E6B4F;">${propertyPhone}</a><br>` : ''}
      ${propertyName}
    </div>
  </div>
</body>
</html>`;

  try {
    await sendEmail({ to: row.email, organizationId: row.organization_id, fromName: row.property_name || undefined, subject, html });
    console.log(`[BookingEmail] Sent confirmation to ${row.email} for reservation ${row.id}`);
    return true;
  } catch (err: any) {
    console.error(`[BookingEmail] Failed for ${row.id}:`, err.message);
    return false;
  }
}
