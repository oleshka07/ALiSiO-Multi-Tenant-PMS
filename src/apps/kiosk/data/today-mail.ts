/**
 * Лист о 7:00: що термінали зробили за вчорашню... ні, за ЦЮ добу готелю.
 *
 * ── Кому і навіщо ───────────────────────────────────────────────────────
 *
 * Рецепції, на адресу ОБʼЄКТА. У фазі `external` це не звіт, а РОБОЧИЙ
 * СПИСОК: гості виїхали через термінал, а фактуру за них виставляє чужа
 * система, і зробити це має людина. Лист — єдине місце, де цей список
 * побачать, доки ніхто не відкрив картку.
 *
 * У фазі `alisio` фактури виставились самі, і той самий лист стає журналом:
 * скільки заселилось, скільки зареєструвалось, де екран не спрацював.
 *
 * ── Мова — юрисдикції, не оператора ─────────────────────────────────────
 *
 * `documentLanguage(propertyId)`, а не `t()` (інваріант 19). Лист іде на
 * адресу готелю в його країні, і німецький готель читає його німецькою,
 * навіть якщо його адміністратор поставив собі українську адмінку.
 *
 * ── Чому лист складається ТУТ, а не в крон-маршруті ─────────────────────
 *
 * Крон — це розклад і секрет; що саме написано в листі, до розкладу не
 * належить. Та сама причина, з якої підсумок доби рахує `today.repo.ts`, а не
 * кожен читач окремо.
 */
import { getSql } from '@core/db/async';
import { documentLanguage } from '@core/i18n/resolve';
import { runWithOrganization } from '@core/auth/tenant-context';
import { sendEmail } from '@core/mail/email';
import { oneProperty } from '@core/property-scope';
import { kioskDay, type KioskDay } from './today.repo';
import { readSystemOfRecord } from '@bookings/kernel';

/**
 * Заголовки й підписи листа — мовами юрисдикцій, які в нас є, і англійська.
 *
 * ── Юрисдикція поза словником падає на АНГЛІЙСЬКУ, не на німецьку ───────
 *
 * Так само, як решта документів цього продукту: `localeForLanguage()`
 * (`invoicing/domain/invoice-document.ts`) віддає `de-DE`, `cs-CZ`, а на все
 * інше — `en-GB`, і причина там написана словами: «надрукувати вигадану
 * форму гірше, ніж надрукувати англійською».
 *
 * Мовчазний `de` тут був би саме вигаданою формою: австрійський готель ще
 * прочитав би, а польський чи французький отримав би лист чужою мовою і
 * вирішив би, що це помилка адреси. Англійська — не «краща мова», це
 * ЗІЗНАННЯ, що своєї в нас для цієї юрисдикції ще немає.
 *
 * Названої ВІДМОВИ тут немає навмисно: відмовитись означало б не надіслати
 * листа зовсім, тобто рецепція не побачила б списку виїздів. Мова листа —
 * гірший бік вибору, ніж його відсутність.
 *
 * Тип названий ЯВНО, а не виведений із `as const`: інакше друга мова мусила б
 * мати ті самі рядки-літерали, що перша, і TypeScript вимагав би від чеської
 * писати німецькою. Спільність тут — у КЛЮЧАХ, і саме її тип і стереже.
 */
interface Words {
  subject: (day: string, name: string) => string;
  checkedIn: string;
  registered: string;
  checkedOut: string;
  errors: string;
  invoiceList: string;
  none: string;
}

const WORDS: Record<'de' | 'cs' | 'en', Words> = {
  de: {
    subject: (day: string, name: string) => `Kiosk ${day} — ${name}`,
    checkedIn: 'Selbst eingecheckt',
    registered: 'Registriert',
    checkedOut: 'Abgereist',
    errors: 'Fehlversuche am Terminal',
    invoiceList: 'Rechnung im Altsystem ausstellen',
    none: 'Keine Vorgänge.',
  },
  cs: {
    subject: (day: string, name: string) => `Kiosek ${day} — ${name}`,
    checkedIn: 'Samoobslužné ubytování',
    registered: 'Registrováno',
    checkedOut: 'Odjezdy',
    errors: 'Neúspěšné pokusy na terminálu',
    invoiceList: 'Vystavit fakturu ve starém systému',
    none: 'Žádné události.',
  },
  en: {
    subject: (day: string, name: string) => `Kiosk ${day} — ${name}`,
    checkedIn: 'Self check-ins',
    registered: 'Registered',
    checkedOut: 'Departures',
    errors: 'Failed attempts at the terminal',
    invoiceList: 'Issue the invoice in the previous system',
    none: 'No activity.',
  },
};

/**
 * Слова для мови документа. Невідома юрисдикція → англійська (див. шапку).
 *
 * Експортована, щоб сцена гейта питала ТУ САМУ функцію, а не свою копію
 * правила: копія доводила б, що правильна копія правильна.
 */
export function words(language: string): Words {
  if (language === 'cs') return WORDS.cs;
  if (language === 'de') return WORDS.de;
  return WORDS.en;
}

export function renderKioskDay(day: KioskDay, w: Words, propertyName: string, phase: string): { subject: string; html: string; text: string } {
  const rows = [
    [w.checkedIn, day.counts.checkedIn],
    [w.registered, day.counts.registered],
    [w.checkedOut, day.counts.checkedOut],
    [w.errors, day.counts.errors],
  ] as const;

  const lines = rows.map(([label, n]) => `${label}: ${n}`);
  // Список для рецепції — лише у фазі дзеркала, і лише коли в ньому є рядки.
  // Порожній заголовок у листі — це заголовок, який навчають ігнорувати.
  const list = phase === 'external' && day.invoiceElsewhere.length > 0
    ? day.invoiceElsewhere.map((e) => `· ${e.reservation_id ?? '—'} (${e.at.slice(11, 16)})`)
    : [];

  const total = day.counts.checkedIn + day.counts.registered + day.counts.checkedOut + day.counts.errors;
  const body = total === 0 && list.length === 0 ? [w.none] : lines;

  const text = [
    `${propertyName} — ${day.day}`,
    '',
    ...body,
    ...(list.length > 0 ? ['', `${w.invoiceList}:`, ...list] : []),
  ].join('\n');

  const html = [
    `<p><strong>${propertyName}</strong> — ${day.day}</p>`,
    `<ul>${body.map((l) => `<li>${l}</li>`).join('')}</ul>`,
    ...(list.length > 0
      ? [`<p><strong>${w.invoiceList}:</strong></p><ul>${list.map((l) => `<li>${l}</li>`).join('')}</ul>`]
      : []),
  ].join('');

  return { subject: w.subject(day.day, propertyName), html, text };
}

export interface KioskMailRun {
  sent: number;
  /** Обʼєкти без ЖИВОГО термінала: застосунку там немає, і це не проблема. */
  skipped: number;
  /**
   * Обʼєкти, де термінал Є, а адреси немає.
   *
   * Окремо від `skipped`, і це не педантизм: перша редакція рахувала обидва
   * випадки одним числом, і крон відповідав `sent: 0, failed: 0` — тобто
   * «відпрацював» — для готелю, який щодня заселяє гостей через термінал і
   * жодного разу не отримав списку. Клас INC-014: функція не зламалась, вона
   * зникла, і ніхто цього не почув.
   *
   * Провалом прогону це НЕ робить: незаповнена адреса — прогалина
   * налаштування, а не відмова крона, і червоніти щоночі через неї означало б
   * навчити ігнорувати червоне. Але число видно в тілі відповіді й у лозі.
   */
  withoutAddress: number;
  failedOrganizations: number;
}

/**
 * Один прохід крона: по всіх готелях, у кожного — по обʼєктах із терміналами.
 *
 * Обʼєкт БЕЗ жодного термінала пропускається мовчки: лист «нуль подій» від
 * застосунку, якого в цьому будинку немає, — це те, що навчаються не читати.
 *
 * Падіння одного готелю не спиняє решти, але рахується: `failedOrganizations`
 * — те саме поле, за яким `deploy/run-cron.sh` відрізняє «крон відпрацював»
 * від «крон відповів 200».
 */
export async function sendKioskDayMails(day?: string | null): Promise<KioskMailRun> {
  const sql = getSql();
  const result: KioskMailRun = { sent: 0, skipped: 0, withoutAddress: 0, failedOrganizations: 0 };
  const orgs = (await sql.rows<{ id: string }>('SELECT id FROM organizations')) as { id: string }[];

  for (const org of orgs) {
    try {
      await runWithOrganization(org.id, async () => {
        const properties = (await sql.rows<{
          id: string; name: string; email: string | null; system_of_record: string | null;
        }>(`SELECT p.id, p.name, p.email, p.system_of_record
              FROM properties p WHERE p.organization_id = ?`,
          [org.id])) as { id: string; name: string; email: string | null; system_of_record: string | null }[];

        for (const property of properties) {
          // Термінали ЦЬОГО будинку — окремим запитом, названим по осі
          // обʼєкта. Перша редакція питала їх підзапитом `EXISTS (… d.property_id
          // = p.id …)`: правильно за змістом, але вісь там зчеплена з `p.id`,
          // а не з `property_id` іншої таблиці, тож статично це «читання
          // kiosk_devices без будинку». Окремий запит каже те саме
          // параметром — і читачеві, і гейту.
          const live = await sql.row<{ n: number }>(
            `SELECT COUNT(*) AS n FROM kiosk_devices d
              WHERE d.organization_id = ? AND d.property_id = ? AND d.revoked_at IS NULL`,
            [org.id, property.id]);
          // Обʼєкт без жодного живого термінала пропускається мовчки: лист
          // «нуль подій» від застосунку, якого в цьому будинку немає, — це те,
          // що навчаються не читати.
          if (!Number(live?.n)) { result.skipped += 1; continue; }
          // Термінал є, адреси немає — це видно числом, а не мовчазним
          // пропуском (див. `withoutAddress`).
          if (!property.email) { result.withoutAddress += 1; continue; }
          const dayData = await kioskDay({
            organizationId: org.id, scope: oneProperty(property.id), day,
          });
          const language = await documentLanguage(property.id);
          const letter = renderKioskDay(
            dayData, words(language), property.name,
            readSystemOfRecord(property.system_of_record),
          );
          await sendEmail({
            to: property.email,
            organizationId: org.id,
            subject: letter.subject,
            html: letter.html,
            text: letter.text,
          });
          result.sent += 1;
        }
      });
    } catch (error) {
      // Один готель не спиняє решти — але мовчазний нуль і справжня відмова
      // мусять розрізнятися, інакше крон «відпрацював» щоранку ні разу не
      // надіславши листа (той самий урок, що GDPR-ретенція).
      result.failedOrganizations += 1;
      console.error(`[kiosk] лист доби не пішов для організації ${org.id}:`, error);
    }
  }
  return result;
}
