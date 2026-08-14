import { getSql } from '@core/db/async';
import { appBaseUrl } from '@core/app-url';
import { sendEmail } from '@core/mail/email';
import { reservationLanguage } from '@core/i18n/resolve';

export async function sendGuestReminderEmail(reservationId: string, origin?: string): Promise<boolean> {
  const sql = getSql();

  const row = await sql.row<any>(`
    SELECT r.id, r.check_in, r.check_out, r.guest_page_token,
           g.first_name, g.last_name, g.email, g.phone,
           u.name as unit_name,
           p.name as property_name
    FROM reservations r
    LEFT JOIN guests g ON r.guest_id = g.id
    LEFT JOIN units u ON r.unit_id = u.id
    LEFT JOIN properties p ON r.property_id = p.id
    WHERE r.id = ?
  `, [reservationId]) as any;

  if (!row || !row.email || !row.guest_page_token) {
    return false;
  }

  // What the guest told us, not what their phone's dialling code suggests.
  // Only four of these letters have a written template, so the rest land on
  // English rather than on a half-translated message.
  const lang = await reservationLanguage(reservationId);
  const tLang = ['uk', 'de', 'cs'].includes(lang) ? lang : 'en';

  /**
   * The arrival date as the guest writes it.
   *
   * `2026-08-04` is a database value, not a date a guest reads. A German
   * reader parses 04.08.2026 without thinking; the ISO form makes them stop
   * and work out which number is the month.
   */
  const LOCALE: Record<string, string> = { en: 'en-GB', uk: 'uk-UA', de: 'de-DE', cs: 'cs-CZ' };
  const arrival = (() => {
    try {
      return new Date(row.check_in).toLocaleDateString(LOCALE[tLang] || 'en-GB',
        { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch { return String(row.check_in); }
  })();

  const guestName = row.first_name ? row.first_name.trim() : (tLang === 'uk' ? 'Гість' : tLang === 'de' ? 'Gast' : tLang === 'cs' ? 'Host' : 'Guest');

  /**
   * The whole name, for the languages that expect one.
   *
   * A German hotel does not open with the guest's first name — «Guten Tag
   * Maria» is what a friend writes, and the guest is being addressed as Sie
   * two lines later. `last_name` was not even in the query above, so there was
   * nothing to be formal with.
   *
   * English and Ukrainian keep the first name: there the full name reads
   * stiff, which is its own kind of wrong.
   */
  const fullName = [row.first_name, row.last_name]
    .map((p: string | null) => (p || '').trim()).filter(Boolean).join(' ') || guestName;
  const propertyName = row.property_name || '';
  const appUrl = origin || appBaseUrl();
  
  const guestPageUrl = `${appUrl}/guest/${row.guest_page_token}`;

  const translations = {
    en: {
      subject: `Action Required: Guest Registration for ${propertyName}`,
      title: 'Fast Check-in: Guest Registration',
      greeting: `Hi ${guestName}!<br><br>We are looking forward to welcoming you to <strong>${propertyName}</strong> on <strong>${arrival}</strong>. To ensure a fast and smooth check-in process, please register all guests before your arrival.`,
      body2: 'You can easily complete the registration online by clicking the button below. This will save you time at the reception.',
      btnText: 'Register Guests Online →',
      footerText: `If you have any questions, just let us know.<br>Best regards, ${propertyName} Team`
    },
    uk: {
      subject: `Дія: Реєстрація гостей у ${propertyName}`,
      title: 'Швидкий Check-in: Реєстрація гостей',
      greeting: `Привіт, ${guestName}!<br><br>Ми з нетерпінням чекаємо на вас у <strong>${propertyName}</strong> з <strong>${arrival}</strong>. Щоб забезпечити швидке заселення, будь ласка, зареєструйте всіх гостей до вашого приїзду.`,
      body2: 'Ви можете легко завершити реєстрацію онлайн, натиснувши кнопку нижче. Це зекономить ваш час на рецепції.',
      btnText: 'Зареєструвати гостей онлайн →',
      footerText: `Якщо у вас є запитання, просто дайте нам знати.<br>З повагою, команда ${propertyName}`
    },
    // Deutsch, wie ein Haus schreibt — nicht wie ein System benachrichtigt.
    //
    // Vorher stand hier «Aktion erforderlich», die wörtliche Übersetzung von
    // "Action required". In einer Hotelmail liest sich das wie Phishing, und
    // «Hallo Maria Schneider!» ist für einen Gast, den man siezt, schlicht
    // falsch. Betreffzeile nennt jetzt das Datum: der Gast erkennt in der
    // Liste sofort, worum es geht.
    de: {
      subject: `Ihre Anreise am ${arrival}: Check-in vorab erledigen`,
      title: 'Vor der Anreise: Gästedaten hinterlegen',
      greeting: `Guten Tag ${fullName},<br><br>wir freuen uns auf Ihren Aufenthalt im <strong>${propertyName}</strong> ab dem <strong>${arrival}</strong>. Wenn Sie die Daten aller Reisenden schon vorab hinterlegen, geht der Check-in an der Rezeption deutlich schneller.`,
      body2: 'Über die Schaltfläche unten öffnet sich Ihre persönliche Gästeseite — dort tragen Sie die Angaben in wenigen Minuten ein. Selbstverständlich können Sie das auch erst bei der Ankunft erledigen.',
      btnText: 'Jetzt vorab eintragen →',
      footerText: `Bei Fragen erreichen Sie uns jederzeit.<br>Mit freundlichen Grüßen<br>Ihr Team vom ${propertyName}`
    },
    cs: {
      subject: `Akce: Registrace hostů pro ${propertyName}`,
      title: 'Rychlý Check-in: Registrace hostů',
      greeting: `Dobrý den ${fullName},<br><br>Těšíme se na vaši návštěvu v <strong>${propertyName}</strong> dne <strong>${arrival}</strong>. Pro zajištění rychlého odbavení prosím zaregistrujte všechny hosty před vaším příjezdem.`,
      body2: 'Registraci můžete snadno dokončit online kliknutím na tlačítko níže. Ušetříte si tak čas na recepci.',
      btnText: 'Registrovat hosty online →',
      footerText: `Pokud máte jakékoli dotazy, dejte nám vědět.<br>S pozdravem, tým ${propertyName}`
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

    <p style="font-size:15px;line-height:1.5;margin:0 0 24px;">
      ${t.body2}
    </p>

    <div>
      <a href="${guestPageUrl}" style="display:inline-block;background:#2E6B4F;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;font-size:15px;">
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
    await sendEmail({ to: row.email, subject: t.subject, html });
    console.log(`[GuestReminder] Sent to ${row.email} for reservation ${row.id}`);
    return true;
  } catch (err: any) {
    console.error(`[GuestReminder] Failed for ${row.id}:`, err.message);
    return false;
  }
}
