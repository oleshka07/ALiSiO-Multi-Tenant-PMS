/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Пошта — чиєю адресою готель пише своїм гостям.
 *
 * ── Що тут було ─────────────────────────────────────────────────────────
 *
 * Один транспорт на весь сервер: `smtp.seznam.cz` з логіном і паролем зі
 * змінних оточення, спільними на всіх клієнтів. Назва готелю підставлялась
 * ЛИШЕ як підпис відправника, а адреса лишалась нашою.
 *
 * Для гостя це виглядало так: підтвердження броні німецького готелю приходило
 * з чеської адреси, яку він не знає, і відповідь на нього летіла не в готель.
 * Для самого готелю це означало, що його листування живе в чужій скриньці і
 * репутація його домену не працює на нього.
 *
 * Це та сама форма, що й синк у Google Sheets, який тут видалили: одна змінна
 * оточення на мультитенантний сервер.
 *
 * ── Як тепер ────────────────────────────────────────────────────────────
 *
 * Кожен виклик називає організацію, і транспорт береться її власний —
 * `channel_credentials`, канал `smtp`, пароль зашифрований тим самим `seal()`,
 * що й ключі платіжних шлюзів. Готель, який своєї пошти не завів, шле з нашої:
 * запасний варіант, а не основний, і екран налаштувань каже, чия адреса зараз.
 *
 * Виклик БЕЗ організації теж лишається робочим і теж іде з нашої скриньки.
 * Це навмисно: перетворити «лист пішов не з тієї адреси» на «лист не пішов»
 * означало б проміняти косметичну ваду на втрачене підтвердження броні.
 *
 * ── Свідоме обмеження ───────────────────────────────────────────────────
 *
 * Порт фіксований 587 зі STARTTLS, адреса відправника дорівнює логіну. Так уже
 * робив і серверний транспорт (465 він мовчки перетворював на 587). Готелю,
 * якому цього замало, потрібні ще два поля й міграція; поки такого немає,
 * конструктор із пʼяти полів на екрані коштував би дорожче за користь.
 */
import nodemailer from 'nodemailer';
import { integrationCredentials } from '../integration-credentials.ts';
import { reportError, reportOk } from '../app-connections.ts';

/**
 * Транспорти за ключем «хост|логін».
 *
 * Не за `organizationId`: два готелі однієї мережі можуть мати ту саму
 * скриньку, і другий транспорт до неї — це друге зʼєднання без причини. А
 * головне, ключ за організацією не помітив би, що готель ЗМІНИВ пароль:
 * кешований транспорт продовжив би ходити зі старим, поки не перезапустять
 * процес.
 */
const transports = new Map<string, any>();

/** Порт і режим — див. «свідоме обмеження» у шапці файлу. */
const SMTP_PORT = 587;

interface Transport { send: any; sender: string; perOrganization: boolean }

async function transportFor(organizationId?: string | null): Promise<Transport | null> {
  const creds = await integrationCredentials('smtp', organizationId);
  const host = creds?.clientId;
  const user = creds?.accessToken;
  const pass = creds?.clientSecret;
  if (!host || !user || !pass) return null;

  const key = `${host}|${user}`;
  let t = transports.get(key);
  if (!t) {
    t = nodemailer.createTransport({
      host,
      port: SMTP_PORT,
      secure: false, // STARTTLS on 587
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
      auth: { user, pass },
    });
    transports.set(key, t);
  }
  return { send: t, sender: user, perOrganization: !!creds?.perOrganization };
}

/** Транспорт більше не кешується — після зміни пароля в налаштуваннях. */
export function forgetMailTransports(): void {
  transports.clear();
}

export interface SendEmailOptions {
  to: string;
  /**
   * Чий це лист. Без нього лист піде зі скриньки сервісу — див. шапку.
   * Кожен виклик, який знає готель, мусить його назвати.
   */
  organizationId?: string | null;
  /** Display name of the sender — the hotel, when the caller knows it. */
  fromName?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename:    string;
    content:     Buffer;
    contentType: string;
  }>;
}

export async function sendEmail({ to, organizationId, fromName, subject, html, text, attachments }: SendEmailOptions): Promise<void> {
  const t = await transportFor(organizationId);
  if (!t) {
    // Ні своєї пошти, ні серверної. Раніше сюди приходив транспорт без
    // облікових даних і падав усередині nodemailer з повідомленням про
    // автентифікацію — тобто про причину доводилось здогадуватись.
    throw new Error('Пошта не налаштована: ані для цього готелю, ані для сервісу');
  }

  const label = fromName || process.env.EMAIL_FROM_NAME || 'ALiSiO ERP';
  await reported(organizationId, () => t.send.sendMail({
    from: `"${label.replace(/"/g, "'")}" <${t.sender}>`,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ''),
    attachments,
  }));
  console.log(`[Email] Sent to ${to} via ${t.perOrganization ? 'hotel' : 'service'} mailbox: ${subject}`);
}

/**
 * Стан звʼязку пошти — у `app_connections` (Блок «Застосунки», 3.4): ЄДИНЕ
 * місце в цьому файлі, яке про нього звітує; відправка і перевірка йдуть
 * крізь нього. На ОРГАНІЗАЦІЮ, без обʼєкта — скринька одна на готель. Виклик
 * без організації нема кому приписати — стану немає. `reportOk`/`reportError`
 * не кидають: відмова транспорту лишається тією самою відмовою для того, хто
 * слав, а не двома.
 */
async function reported<T>(organizationId: string | null | undefined, work: () => Promise<T>): Promise<T> {
  try {
    const out = await work();
    if (organizationId) await reportOk('smtp', organizationId);
    return out;
  } catch (e) {
    if (organizationId) await reportError('smtp', organizationId, e);
    throw e;
  }
}

/**
 * «Перевірити звʼязок» з екрана «Застосунки»: зʼєднання і автентифікація
 * без листа (`verify()` nodemailer). Без транспорту — відмова з текстом, і
 * вона теж записується як стан: «пошта не налаштована» — це те, що готель
 * має побачити на картці.
 */
export async function probeMail(organizationId: string): Promise<void> {
  await reported(organizationId, async () => {
    const t = await transportFor(organizationId);
    if (!t) throw new Error('Пошта не налаштована: ані для цього готелю, ані для сервісу');
    await t.send.verify();
  });
}
