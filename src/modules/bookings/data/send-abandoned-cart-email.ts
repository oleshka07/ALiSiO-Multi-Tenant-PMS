import { getSql } from '@core/db/async';
import { organizationCurrency } from '@core/currency';
import { appBaseUrl } from '@core/app-url';
import { hasFeature } from '@core/features';
import { sendEmail } from '@core/mail/email';
import { reservationLanguage } from '@core/i18n/resolve';

/**
 * The amount as the guest reads it, not as Kyiv writes it.
 *
 * `toLocaleString('uk-UA')` was fixed here, so a German guest saw a Ukrainian
 * thousands separator on a euro amount in a German letter.
 */
const LOCALE: Record<string, string> = { en: 'en-GB', uk: 'uk-UA', de: 'de-DE', cs: 'cs-CZ' };

function fmtPrice(n: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)} ${currency}`;
  }
}

export async function sendAbandonedCartEmail(reservationId: string, origin?: string): Promise<boolean> {
  const sql = getSql();

  // `u.thank_you_url` used to be in this list. The column is on site_listings,
  // not on units, so the query threw before anything was sent and the caller
  // read the failure as "no cart to remind about". It is fetched below, from
  // the table that actually has it.
  const row = await sql.row<any>(`
    SELECT r.id, r.unit_id, r.check_in, r.check_out, r.nights, r.total_price, r.currency,
           r.guest_page_token,
           g.first_name, g.email, g.phone,
           u.name as unit_name,
           p.name as property_name, p.organization_id
    FROM reservations r
    LEFT JOIN guests g ON r.guest_id = g.id
    LEFT JOIN units u ON r.unit_id = u.id
    LEFT JOIN properties p ON r.property_id = p.id
    WHERE r.id = ?
  `, [reservationId]) as any;

  if (!row || !row.email || !row.guest_page_token) {
    return false;
  }

  // The hotel's own "thank you" page, when the listing this unit was sold
  // through names one. Absent — and absent is the normal case — the guest page
  // is the destination.
  let thankYouUrl: string | null = null;
  if (row.unit_id) {
    const listing = await sql.row<any>(
      `SELECT sl.thank_you_url FROM site_listings sl
         JOIN booking_sites bs ON bs.id = sl.site_id
        WHERE sl.unit_id = ? AND bs.status <> 'deleted' AND sl.thank_you_url IS NOT NULL
        LIMIT 1`,
      [row.unit_id],
    );
    thankYouUrl = listing?.thank_you_url ?? null;
  }

  // What the guest told us, not what their phone's dialling code suggests.
  // Only four of these letters have a written template, so the rest land on
  // English rather than on a half-translated message.
  const lang = await reservationLanguage(reservationId);
  const tLang = ['uk', 'de', 'cs'].includes(lang) ? lang : 'en';

  const guestName = row.first_name ? row.first_name.trim() : (tLang === 'uk' ? 'Гість' : tLang === 'de' ? 'Gast' : tLang === 'cs' ? 'Host' : 'Guest');
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
  const total = fmtPrice(row.total_price || 0, currency, LOCALE[tLang] || 'en-GB');
  const propertyName = row.property_name || '';
  const appUrl = origin || appBaseUrl();
  // Куди веде «Завершити бронювання»: на сторінку готелю, якщо лістинг її
  // назвав, інакше — на гостьову сторінку, і лише готелю з модулем
  // `guest_page` (Блок 0.6 B2). Лист, у якому нікуди йти завершувати, не
  // надсилається: це нагадування про дію, а не інформація.
  let guestPageUrl = null;
  if (row.guest_page_token) {
    if (thankYouUrl) {
      const sep = thankYouUrl.includes('?') ? '&' : '?';
      guestPageUrl = `${thankYouUrl}${sep}guest_token=${row.guest_page_token}`;
    } else if (await hasFeature(row.organization_id, 'guest_page')) {
      guestPageUrl = `${appUrl}/guest/${row.guest_page_token}`;
    }
  }
  if (!guestPageUrl) return false;

  const translations = {
    en: {
      subject: `Complete your booking — ${propertyName}`,
      title: 'Did you forget to complete your booking?',
      greeting: `Hi ${guestName}!<br><br>We noticed you started booking (<strong>${row.unit_name || 'Accommodation'}</strong> for <strong>${row.nights} nights</strong>) but didn't complete the payment.`,
      checkIn: 'Check-in:',
      checkOut: 'Check-out:',
      totalLabel: 'Total to pay:',
      body2: 'Your details are safely stored. To guarantee your reservation, please click the link below and complete your payment.',
      btnText: 'Complete Booking →',
      footerText: `If you have any issues with payment or any questions, just let us know.<br>Best regards, ${propertyName} Team`
    },
    uk: {
      subject: `Завершіть своє бронювання — ${propertyName}`,
      title: 'Ви забули завершити бронювання?',
      greeting: `Привіт, ${guestName}!<br><br>Ми помітили, що ви почали процес бронювання (<strong>${row.unit_name || 'Будиночок'}</strong> на <strong>${row.nights} ночей</strong>), але не завершили його оплатою.`,
      checkIn: 'Заїзд:',
      checkOut: 'Виїзд:',
      totalLabel: 'До сплати:',
      body2: 'Ваші дані вже збережені. Щоб гарантувати своє бронювання, будь ласка, перейдіть за посиланням нижче та завершіть оплату.',
      btnText: 'Завершити бронювання →',
      footerText: `Якщо у вас виникли проблеми з оплатою або запитання, просто дайте нам знати.<br>З повагою, команда ${propertyName}`
    },
    de: {
      subject: `Schließen Sie Ihre Buchung ab — ${propertyName}`,
      title: 'Haben Sie vergessen, Ihre Buchung abzuschließen?',
      greeting: `Hallo ${guestName}!<br><br>Wir haben festgestellt, dass Sie Ihre Buchung (<strong>${row.unit_name || 'Unterkunft'}</strong> für <strong>${row.nights} Nächte</strong>) gestartet, aber die Zahlung nicht abgeschlossen haben.`,
      checkIn: 'Check-in:',
      checkOut: 'Check-out:',
      totalLabel: 'Zu zahlen:',
      body2: 'Ihre Daten sind sicher gespeichert. Um Ihre Reservierung zu garantieren, klicken Sie bitte auf den untenstehenden Link und schließen Sie Ihre Zahlung ab.',
      btnText: 'Buchung abschließen →',
      footerText: `Wenn Sie Probleme mit der Zahlung oder Fragen haben, lassen Sie es uns einfach wissen.<br>Mit freundlichen Grüßen, Ihr ${propertyName} Team`
    },
    cs: {
      subject: `Dokončete svou rezervaci — ${propertyName}`,
      title: 'Zapomněli jste dokončit rezervaci?',
      greeting: `Dobrý den ${guestName}!<br><br>Všimli jsme si, že jste začali rezervaci (<strong>${row.unit_name || 'Ubytování'}</strong> na <strong>${row.nights} nocí</strong>), ale nedokončili jste platbu.`,
      checkIn: 'Check-in:',
      checkOut: 'Check-out:',
      totalLabel: 'K úhradě:',
      body2: 'Vaše údaje jsou bezpečně uloženy. Chcete-li zaručit svou rezervaci, klikněte na odkaz níže a dokončete platbu.',
      btnText: 'Dokončit rezervaci →',
      footerText: `Pokud máte nějaké problémy s platbou nebo dotazy, dejte nám vědět.<br>S pozdravem, tým ${propertyName}`
    }
  };

  const t = translations[tLang as keyof typeof translations];
  
  const html = `<!DOCTYPE html>
<html lang="${tLang}">
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto;padding:24px;background:#f7f7f9;">
  <div style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 16px rgba(0,0,0,0.04);text-align:center;">
    <div style="font-size:24px;color:#2E6B4F;font-weight:700;margin-bottom:16px;">${t.title}</div>
    
    <p style="font-size:16px;line-height:1.5;margin:0 0 20px;">
      ${t.greeting}
    </p>

    <div style="background:#f9f9f9;border-radius:12px;padding:16px;margin:20px 0;text-align:left;">
      <div style="margin-bottom:8px;font-size:14px;"><strong>${t.checkIn}</strong> ${row.check_in}</div>
      <div style="margin-bottom:8px;font-size:14px;"><strong>${t.checkOut}</strong> ${row.check_out}</div>
      <div style="font-size:16px;font-weight:700;color:#2E6B4F;margin-top:12px;">${t.totalLabel} ${total}</div>
    </div>

    <p style="font-size:15px;line-height:1.5;margin:0 0 24px;">
      ${t.body2}
    </p>

    <div>
      <a href="${guestPageUrl}" style="display:inline-block;background:#FF6B00;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;font-size:15px;">
        ${t.btnText}
      </a>
    </div>

    <hr style="border:none;border-top:1px solid #eee;margin:28px 0 16px;">
    <div style="font-size:13px;color:#777;line-height:1.5;">
      ${t.footerText}
    </div>
  </div>
</body>
</html>`;

  try {
    await sendEmail({ to: row.email, organizationId: row.organization_id, fromName: row.property_name || undefined, subject: t.subject, html });
    console.log(`[AbandonedCart] Sent to ${row.email} for reservation ${row.id}`);
    return true;
  } catch (err: any) {
    console.error(`[AbandonedCart] Failed for ${row.id}:`, err.message);
    return false;
  }
}
