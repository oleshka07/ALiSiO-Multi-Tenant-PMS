import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@core/mail/email';
import { withOwner, forbidden } from '@core/auth/session';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';

/**
 * «Перевірити пошту» — і нічого більше.
 *
 * Було: `?to=` брався з рядка запиту як є, і лист ішов на БУДЬ-ЯКУ адресу
 * через SMTP готелю, з його ж іменем у полі From. Тобто діагностичний екран
 * був кнопкою «надішли що завгодно кому завгодно від імені готелю»: відкритий
 * релей у межах тенанта. Варта `withOwner` тут не рятує — власник тенанта і є
 * тим, хто цим скористається; вона обмежує, ХТО надсилає, а не КОМУ.
 *
 * Стало: адреса береться з того, що система вже знає про цю організацію.
 *
 *   - за замовчуванням — адреса самого користувача із сесії. Саме вона
 *     потрібна в 99% випадків: людина натискає «перевірити» і йде дивитись у
 *     свою скриньку;
 *   - `?to=` лишається, але як ВИБІР ІЗ ПЕРЕЛІКУ, а не як довільне значення.
 *     Дозволені: власна адреса з сесії та контактні адреси об'єктів цієї
 *     організації (`properties.email`) — тобто скриньки, на які готель і так
 *     отримує пошту від системи. Перевірити, що лист доходить до
 *     info@<готель>, — це реальний сценарій, заради якого параметр і був.
 *
 * Чому перелік, а не regex-валідація домену: домен готелю в базі не
 * зберігається, а «схоже на адресу цього готелю» — це вгадування. Перелік
 * будується із рядків, які в базі вже є, тож нічого нового вигадувати не
 * треба, і розширити його можна лише додавши адресу в налаштуваннях —
 * тобто залишивши слід.
 *
 * `organizations` власної контактної адреси не має (див. схему в
 * `src/lib/db.ts`), тому джерело контактних адрес — `properties`.
 */
export const GET = withOwner(async (request: NextRequest, _context, actor) => {
  const { searchParams } = new URL(request.url);
  const sql = getSql();

  // organization_id називається явно, хоча withOwner уже поставив орендаря на
  // з'єднання: на SQLite політик немає, і без цього умови запит віддав би
  // об'єкти всіх готелів.
  const contacts = await sql.rows<{ email: string | null }>(
    `SELECT email FROM properties
      WHERE organization_id = ? AND email IS NOT NULL AND TRIM(email) <> ''`,
    [actor.organizationId],
  );

  // Ключ — адреса в нижньому регістрі (порівняння), значення — те написання,
  // яке справді лежить у базі (його і відправляємо).
  const allowed = new Map<string, string>();
  for (const address of [actor.user.email, ...contacts.map((r) => r.email)]) {
    const value = address?.trim();
    if (value) allowed.set(value.toLowerCase(), value);
  }

  const requested = searchParams.get('to')?.trim();
  if (requested && !allowed.has(requested.toLowerCase())) {
    // 403, а не 400: адреса синтаксично коректна, просто не належить цій
    // організації. Перелік у відповіді — це адреси, які власник і так бачить
    // у своїх же налаштуваннях, тож нічого чужого він тут не дізнається.
    return forbidden(
      'Тестовий лист можна надіслати лише на адресу, яку система вже знає для цієї організації.',
    );
  }

  // Немає параметра — свій же email із сесії. Мовчазного дефолту «кудись» тут
  // бути не може: адреса завжди походить із особи запиту або з її організації.
  const to = requested ? allowed.get(requested.toLowerCase())! : actor.user.email;

  const config = {
    host: process.env.EMAIL_CZ_SMTP_HOST || 'smtp.seznam.cz',
    port: process.env.EMAIL_CZ_SMTP_PORT || '465',
    user: process.env.EMAIL_CZ_USER ? 'Set ✅' : 'Missing ❌',
    pass: process.env.EMAIL_CZ_PASSWORD ? 'Set ✅' : 'Missing ❌',
  };

  try {
    await sendEmail({
      to,
      // Тест мусить іти ТИМ САМИМ шляхом, що й справжній лист гостю, інакше
      // він доводить працездатність чужої скриньки.
      organizationId: actor.organizationId,
      subject: 'ALiSiO Test Email',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2 style="color: #00A3E0;">Test Email</h2>
          <p>This is a test email sent from the ALiSiO-Hotel-PMS system.</p>
          <p>If you received this, the SMTP configuration (EMAIL_CZ_USER, EMAIL_CZ_PASSWORD, etc.) is working correctly!</p>
          <hr />
          <p style="font-size: 12px; color: #666;">Time of send: ${new Date().toISOString()}</p>
        </div>
      `,
    });

    return NextResponse.json({
      success: true,
      message: `Test email successfully sent to ${to}.`,
      // Куди ще дозволено — щоб екран міг показати вибір замість поля вводу.
      allowedRecipients: [...allowed.values()],
      config,
    });
  } catch (error) {
    // Текст помилки SMTP містить хост, логін і причину відмови автентифікації
    // — він іде в лог, а не клієнту (AGENTS.md §3.6).
    return serverError('api/test-email', error, 'Не вдалося надіслати тестовий лист. Перевірте налаштування SMTP.');
  }
});
