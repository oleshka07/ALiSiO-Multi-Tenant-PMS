/**
 * Як звʼязатися з рецепцією — те, що друкується на аркуші A4.
 *
 * Джерело — `property_guest_config`: там уже лежить `whatsapp_phone`, яким
 * користується гостьова сторінка, і туди ж 0422 поклав `reception_hours`.
 * Другого списку контактів не заводиться: два рядки «як нам подзвонити»
 * розійшлися б, і розбіжність побачив би гість із надрукованим аркушем.
 *
 * Орендар НАЗВАНО в запиті через `properties`, а не лише покладено на
 * політику: на SQLite політик немає, а SQLite це вся розробка (рід INC-014).
 * `property_guest_config` не має власного `organization_id` — вона висить на
 * обʼєкті, тож джойн і є тут перевіркою належності.
 */
import { getSql } from '@core/db/async';

export interface ReceptionContact {
  /** Номер для WhatsApp, як його ввів готель. Порожньо — кнопки немає. */
  whatsapp: string | null;
  /** «8:00 – 22:00», «цілодобово» — рядок готелю, не наш переказ. */
  hours: string | null;
  /** Хто відповість: «Анна», «Frau Müller», «черговий адміністратор» (0424). */
  name: string | null;
}

/** Кличеться ВСЕРЕДИНІ `runWithOrganization`. Немає рядка — обидва `null`. */
export async function receptionContact(
  organizationId: string, propertyId: string,
): Promise<ReceptionContact> {
  const row = await getSql().row<{
    whatsapp_phone: string | null; reception_hours: string | null; reception_name: string | null;
  }>(
    `SELECT c.whatsapp_phone, c.reception_hours, c.reception_name
       FROM property_guest_config c
       JOIN properties p ON p.id = c.property_id
      WHERE c.property_id = ? AND p.organization_id = ?`,
    [propertyId, organizationId]);

  const clean = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim();
    return t ? t : null;
  };
  return {
    whatsapp: clean(row?.whatsapp_phone),
    hours: clean(row?.reception_hours),
    name: clean(row?.reception_name),
  };
}

/**
 * Посилання, яке відкриває чат — саме воно кодується в другий QR.
 *
 * `wa.me` хоче САМІ ЦИФРИ: `+00 000 000 000` у шляху дає сторінку помилки,
 * і побачить це гість, а не ми. Номер, у якому після чистки нічого не
 * лишилось або лишилось надто мало, — `null`: краще без кнопки, ніж код,
 * що веде в нікуди (той самий довід, що з адресою аркуша).
 */
export function whatsappLink(raw: string | null): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}
