/**
 * Двоє рядків — одна людина (INC-300, CORE-GAPS п. 11).
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * 37 тис. адрес в адресній книзі Winhotel; без злиття та сама людина ляже
 * десятки разів і розповзеться по бронях, фактурах і згодах. Але дублікатів
 * наробляє й портьє, щодня, у будь-якому готелі — тож це ядро, а не імпортна
 * обслуга.
 *
 * ── Злитого гостя НЕ ВИДАЛЯЮТЬ ──────────────────────────────────────────
 *
 * Рядок лишається з `merged_into` на того, кого лишили. Причина не
 * сентиментальна: посилання на нього лежать у виданих документах і в чужих
 * системах, і «такого гостя немає» — гірша відповідь, ніж «це та сама людина».
 *
 * ── Ланцюгів не буває ЗА ПОБУДОВОЮ ──────────────────────────────────────
 *
 * A→B, потім B→C зробило б `merged_into` ланцюгом, і кожен читач мусив би
 * його розкручувати — а читач без запобіжника на циклі просто зависає.
 * Замість покладатися на всіх читачів, злиття ПЕРЕНАЦІЛЮЄ старі посилання:
 * усе, що вело на B, після другого злиття веде на C напряму. Тому
 * `merged_into` завжди веде на живого ОДНИМ кроком, і зливати вже злитого —
 * названа відмова, а не мовчазне «ще раз».
 */
import { getSql } from '@core/db/async';
import { refuse } from '@core/http/refusal';

/**
 * Хто носить посилання на гостя і переїжджає при злитті.
 *
 * Список — ДАНІ, а не розсипані по коду запити: наступна таблиця з `guest_id`
 * інакше мовчки лишиться позаду, і дізнаються про це, коли в неї заглянуть.
 * Повноту списку стереже `scripts/check-guest-merge-tables.mjs`: він читає
 * `schema.sql` і червоніє на таблиці, якої немає ні тут, ні в списку свідомо
 * не перенесених нижче.
 */
export const MOVED_TO_KEPT_GUEST: readonly string[] = [
  'reservations',
  'reservation_guests',
  'guest_registrations',
  'guest_consents',
];

/**
 * Носить `guest_id`, але при злитті НЕ переїжджає — і чому саме.
 *
 * `fin_folios` — книга проживання, тека модуля фінансів. Не чіпається тут із
 * двох причин, і друга важливіша за першу: це чужа тека, і рядок від цього не
 * ламається — `merged_into` лишає його розвʼязним до живої людини одним
 * кроком. Коли фінанси захочуть переносити й фоліо, вони знімуть цей рядок
 * звідси, і гейт це помітить.
 */
export const NOT_MOVED: Readonly<Record<string, string>> = {
  fin_folios: 'книга проживання — тека @finance; merged_into лишає рядок розвʼязним',
};

export interface MergeGuestsInput {
  organizationId: string;
  /** Кого лишаємо. */
  keepId: string;
  /** Кого зливаємо. */
  dropId: string;
}

export interface MergeGuestsResult {
  keepId: string;
  dropId: string;
  /** Скільки рядків переїхало, по таблицях — для журналу і для звіту оператору. */
  moved: Record<string, number>;
}

/** Живий гість цього орендаря — або названа відмова (інваріанти 5 і 13). */
async function liveGuest(organizationId: string, guestId: string, role: string): Promise<void> {
  const sql = getSql();
  const row = await sql.row<{ merged_into: string | null }>(
    'SELECT merged_into FROM guests WHERE id = ? AND organization_id = ?',
    [guestId, organizationId]);
  // Порожньо — «не наш» на обох рушіях, хоч і з різних причин: на Postgres
  // політика не показує чужого рядка, на SQLite його відсікає умова.
  if (!row) refuse(`Гостя не знайдено (${role})`, 404);
  if (row.merged_into != null) {
    refuse(`Цього гостя вже злито з іншим (${role})`, 400);
  }
}

/**
 * Перенести все з `dropId` на `keepId` і лишити слід.
 *
 * Однією транзакцією: половина перенесених броней при цілих реєстраціях —
 * стан, якого не можна ні побачити, ні полагодити, бо ніде не записано, де
 * саме воно спинилось.
 */
export async function mergeGuests(input: MergeGuestsInput): Promise<MergeGuestsResult> {
  const { organizationId, keepId, dropId } = input;

  if (keepId === dropId) {
    refuse('Це той самий гість — зливати нема чого', 400);
  }
  await liveGuest(organizationId, keepId, 'кого лишаємо');
  await liveGuest(organizationId, dropId, 'кого зливаємо');

  const sql = getSql();
  const moved: Record<string, number> = {};

  await sql.tx(async (t) => {
    for (const table of MOVED_TO_KEPT_GUEST) {
      const before = await t.row<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE guest_id = ?`, [dropId]);
      moved[table] = Number(before?.n ?? 0);
      await t.run(`UPDATE ${table} SET guest_id = ? WHERE guest_id = ?`, [keepId, dropId]);
    }

    // Слід. Разом із ним — ПЕРЕНАЦІЛЕННЯ старих посилань, щоб ланцюга не
    // виникло: усе, що вело на злитого, тепер веде на живого одним кроком.
    await t.run(
      'UPDATE guests SET merged_into = ? WHERE id = ? AND organization_id = ?',
      [keepId, dropId, organizationId]);
    await t.run(
      'UPDATE guests SET merged_into = ? WHERE merged_into = ? AND organization_id = ?',
      [keepId, dropId, organizationId]);

    // ── Згоди: ВІДКЛИКАННЯ ПЕРЕМАГАЄ ЗГОДУ, завжди ───────────────────────
    //
    // Дві людини, у однієї «маркетинг: так», у другої «ні». Обʼєднати в «так»
    // означало б розсилку тому, хто відмовився, — тобто зробити злиття
    // способом обійти відмову. Тому для КОЖНОГО роду, у якому серед злитих
    // рядків є хоч одне відкликання, живі рядки того роду теж гасяться.
    //
    // Рядки при цьому не зникають: доказ «згода була і її знято» лишається,
    // змінюється лише чинність.
    const revokedKinds = await t.rows<{ consent_kind: string }>(
      `SELECT DISTINCT consent_kind FROM guest_consents
        WHERE organization_id = ? AND guest_id = ? AND revoked_at IS NOT NULL`,
      [organizationId, keepId]);
    for (const kind of revokedKinds) {
      await t.run(
        `UPDATE guest_consents SET revoked_at = CURRENT_TIMESTAMP
          WHERE organization_id = ? AND guest_id = ? AND consent_kind = ? AND revoked_at IS NULL`,
        [organizationId, keepId, kind.consent_kind]);
    }
  });

  return { keepId, dropId, moved };
}
