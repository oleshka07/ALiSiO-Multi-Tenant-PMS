/**
 * Картка застосунку: які будинки мають адресу, і кнопка її видати.
 *
 * ── Чому екран, а не команда на сервері ─────────────────────────────────
 *
 * Спершу ключ видавав скрипт (`deploy/guest-app-key.sh`), і він НЕ ПРАЦЮВАВ:
 * читав `properties` без орендаря, а на Postgres роль застосунку з порожнім
 * орендарем бачить нуль рядків — мовчки. Оператор дістав порожній перелік і
 * висновок «застосунків немає». Це AGENTS §7 дослівно, і коментар у тому
 * скрипті стверджував протилежне.
 *
 * Тут орендар приходить із СЕСІЇ (інваріант 1), тобто питання про той самий
 * рахунок, у який адміністратор і зайшов.
 *
 * ── Що видача ключа означає ─────────────────────────────────────────────
 *
 * Не «увімкнути»: вмикач — ключ реєстру фіч, і без нього сторінка 404 навіть
 * із виписаним ключем (`data/property.repo.ts`). Ключ — це АДРЕСА, за якою
 * сторінка існує, і він публічний за призначенням: його друкують на наліпці.
 *
 * Заміна (`rotate`) — не «оновити», а ВІДКЛЮЧИТИ надруковані наліпки: усі
 * вони перестають вести куди-небудь тієї ж секунди. Тому окремою дією, а не
 * мовчазним переписуванням.
 */
import { NextResponse } from 'next/server';
import { withOwner, type Actor } from '@core/auth/session';
import { hasFeature } from '@core/features';
import { handleError, refuse } from '@core/http/errors';
import { getSql } from '@core/db/async';
import { ownsProperty } from '@properties/kernel';
import { generateGuestAppKey } from '../domain/key';
import { brandAssetsOf } from '@properties/brand-assets';
import { buildSheet, renderSheetPdf, type SheetOverrides } from '@properties/a4-sheet';
import { parseLanguage } from '@core/i18n/languages';
import QRCode from 'qrcode';
import { publicOrigin } from '@core/public-origin';

const APP = 'guest_app';

export interface GuestAppHouse {
  propertyId: string;
  name: string;
  /** `null` — ключа ще не видано, і сторінки за жодною адресою немає. */
  key: string | null;
  /** Чия книга головна: від цього залежить, продає сторінка чи передає. */
  systemOfRecord: string;
}

/** Будинки рахунку і їхні ключі. */
export const listGuestAppHouses = withOwner(async (_request: Request, _ctx: unknown, actor: Actor) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    const sql = getSql();
    const rows = await sql.rows<{
      id: string; name: string; guest_app_key: string | null; system_of_record: string | null;
    }>(
      `SELECT id, name, guest_app_key, system_of_record
         FROM properties WHERE organization_id = ? ORDER BY name`,
      [actor.organizationId]);
    const houses: GuestAppHouse[] = rows.map((r) => ({
      propertyId: r.id, name: r.name, key: r.guest_app_key,
      systemOfRecord: r.system_of_record ?? 'alisio',
    }));
    return NextResponse.json({ houses });
  } catch (error) {
    return handleError('apps/guest-app listHouses', error, 'Не вдалося прочитати застосунок');
  }
});

/** Видати ключ будинку — або замінити наявний. */
export const issueGuestAppKey = withOwner(async (request: Request, _ctx: unknown, actor: Actor) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const propertyId = String(body.propertyId ?? '').trim();
    const rotate = body.rotate === true;

    // Обʼєкт — СВІЙ. Чужий id відповідає «немає» (інваріант 5): інакше ключ
    // виписався б на будинок сусіднього рахунку.
    if (!propertyId || !(await ownsProperty(actor.organizationId, propertyId))) {
      refuse('Не знайдено', 404);
    }

    const sql = getSql();
    const has = await sql.row<{ guest_app_key: string | null }>(
      'SELECT guest_app_key FROM properties WHERE id = ? AND organization_id = ?',
      [propertyId, actor.organizationId]);
    if (!has) refuse('Не знайдено', 404);

    // Ключ уже є, заміни не просили — віддаємо наявний. Мовчки перевипустити
    // означало б зробити надруковані наліпки непрацюючими за одне натискання
    // кнопки, підписаної «видати».
    if (has.guest_app_key && !rotate) {
      return NextResponse.json({ key: has.guest_app_key, created: false });
    }

    const key = generateGuestAppKey();
    await sql.run(
      'UPDATE properties SET guest_app_key = ? WHERE id = ? AND organization_id = ?',
      [key, propertyId, actor.organizationId]);

    // Читаємо НАЗАД окремим запитом: `UPDATE` без помилки не доводить, що
    // рядок змінився — політика могла відхилити його мовчки (рід И4).
    const back = await sql.row<{ guest_app_key: string | null }>(
      'SELECT guest_app_key FROM properties WHERE id = ? AND organization_id = ?',
      [propertyId, actor.organizationId]);
    if (back?.guest_app_key !== key) refuse('Ключ не записався. Спробуйте ще раз', 409);

    return NextResponse.json({ key, created: true });
  } catch (error) {
    return handleError('apps/guest-app issueKey', error, 'Не вдалося видати ключ');
  }
});

/**
 * Один рядок обʼєкта для аркуша — і ВІСЬ ОБʼЄКТА разом із орендарем.
 *
 * `manage_properties` каже, що оператор може керувати обʼєктами; воно не
 * каже — ЧИЇМИ. Чужий `propertyId` мусить дати 404, а не чужий аркуш
 * (інваріант 5, клас INC-029). Ключа в параметрах немає навмисно: приймати
 * його означало б дати намалювати аркуш на чужий ключ.
 */
async function sheetRowOf(organizationId: string, propertyId: string) {
  const sql = getSql();
  const row = await sql.row<{
    id: string; name: string; address: string | null; city: string | null;
    phone: string | null; guest_app_key: string | null;
  }>(
    `SELECT id, name, address, city, phone, guest_app_key
       FROM properties WHERE id = ? AND organization_id = ?`,
    [propertyId, organizationId]);
  if (!row) refuse('Не знайдено', 404);
  if (!row!.guest_app_key) refuse('Спершу видайте ключ — без нього аркуш вести нікуди', 409);
  return row!;
}

/**
 * Адреса цього сервера — З ЗАГОЛОВКІВ, а не з сокета.
 *
 * Тут стояло `new URL(request.url)`, і перший же надрукований аркуш вийшов
 * із `https://0.0.0.0:3000/stay/…` — і в підписі, і в QR. `0.0.0.0` це
 * адреса, на якій процес СЛУХАЄ: у прод-образі Next standalone слухає саме
 * її, а назовні стоїть nginx. У розробника `request.url` дає
 * `localhost:3000`, що для нього правда, тож локально все виглядало
 * правильно — видно було лише на папері, після друку.
 *
 * Немає звідки взяти — НАЗВАНА ВІДМОВА, не вигадана адреса: пачка паперу з
 * мертвим кодом гірша за ненадруковану (той самий довід, що інваріант 17
 * про ціну). Правило й фікстури — `core/public-origin.check`.
 */
function originOf(request: Request): string {
  const origin = publicOrigin(request.headers);
  if (!origin) {
    // 409, не 5xx: `check-refusal-status` тримає названі відмови в 4xx, і
    // слушно — `handleError` віддає їх ДОСЛІВНО, тож 5xx тут був би обходом
    // маскування помилок. Стан середовища, у якому дію зробити не можна, —
    // це те саме, що «спершу видайте ключ» поруч.
    refuse('Не вдалося визначити адресу сервера, тож QR вів би в нікуди. '
      + 'Назвіть APP_URL у налаштуваннях середовища і спробуйте ще раз.', 409);
  }
  return origin!;
}

/**
 * QR поруч із посиланням — те саме зображення, що поїде на папір.
 *
 * Один генератор на екран і на друк навмисно: два означали б, що колись
 * вони розійдуться, і оператор перевірить телефоном ОДИН код, а надрукує
 * інший.
 */
export const guestAppQr = withOwner(async (request: Request, _ctx: unknown, actor: Actor) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    const propertyId = new URL(request.url).searchParams.get('propertyId') ?? '';
    const row = await sheetRowOf(actor.organizationId, propertyId);
    const url = `${originOf(request)}/stay/${row.guest_app_key}`;
    const png = await QRCode.toBuffer(url, {
      margin: 4, width: 600, errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    return new NextResponse(new Uint8Array(png), {
      headers: {
        'content-type': 'image/png',
        // Не кешувати: заміна ключа (КІ35) має бути видима одразу, інакше
        // оператор перевірить телефоном код, якого вже немає.
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return handleError('apps/guest-app qr', error);
  }
});

/**
 * Аркуш A4 із QR — PDF.
 *
 * Правки оператора приходять тілом і діють РАЗОВО (рішення власника 18.09):
 * телефон рецепції часто не той, що загальний у картці обʼєкта, але зберігати
 * його окремою колонкою ми не стали — нема чого заводити другий телефон
 * готелю, який розійдеться з першим.
 */
export const guestAppSheet = withOwner(async (request: Request, _ctx: unknown, actor: Actor) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const propertyId = String(body.propertyId ?? '');
    const row = await sheetRowOf(actor.organizationId, propertyId);

    const org = await getSql().row<{ language: string | null }>(
      'SELECT language FROM organizations WHERE id = ?', [actor.organizationId]);
    const brand = await brandAssetsOf(actor.organizationId, row.id);

    const overrides: SheetOverrides = {
      hotelName: typeof body.hotelName === 'string' ? body.hotelName : undefined,
      address: typeof body.address === 'string' ? body.address : undefined,
      phone: typeof body.phone === 'string' ? body.phone : undefined,
      headline: typeof body.headline === 'string' ? body.headline : undefined,
      note: typeof body.note === 'string' ? body.note : undefined,
    };

    const sheet = buildSheet({
      name: row.name,
      address: row.address,
      city: row.city,
      phone: row.phone,
      guestAppKey: row.guest_app_key!,
      hotelLanguage: parseLanguage(org?.language, 'en'),
      brand,
    }, originOf(request), overrides);

    const pdf = await renderSheetPdf(sheet);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="qr-${row.guest_app_key}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return handleError('apps/guest-app sheet', error);
  }
});
