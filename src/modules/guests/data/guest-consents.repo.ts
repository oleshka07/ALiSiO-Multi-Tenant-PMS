/**
 * Журнал згод ОСОБИ — те, що готель показує наглядачеві (INC-300).
 *
 * ── Чому не колонка на `guests` ─────────────────────────────────────────
 *
 * Колонки `marketing_opt_in` тут навмисно немає. «Чи можна цій людині слати
 * листи» — ПОХІДНЕ від журналу, і рахується щоразу. Колонка була б другим
 * джерелом тієї самої правди, а два джерела розходяться: відповідало б те,
 * яке спитали останнім. Ціна такого рішення — джойн на екрані розсилки; ціна
 * протилежного — лист тому, хто відмовився.
 *
 * ── Чому не `guest_registrations.consent_*` ─────────────────────────────
 *
 * Ті колонки лишаються і значать інше: згоду на ЦЬОМУ перебуванні, частину
 * Meldeschein. Ця таблиця — про особу, і вона переживає всі брони гостя,
 * включно з нульом броней (саме такі 61 тис. рядків приносить імпорт
 * Winhotel). Через місяць вони виглядатимуть як дублікати одне одного — не
 * зливайте: перше зруйнує Meldeschein, друге — доказ згоди.
 */
import { getSql } from '@core/db/async';
import { refuse } from '@core/http/refusal';

/** Рід згоди. Словник — у docs/NAMING.md §2. */
export type ConsentKind = 'marketing' | 'data_processing' | 'profiling';

/** Звідки прийшла згода. Словник — у docs/NAMING.md §2. */
export type ConsentSource = 'portal' | 'reception' | 'widget' | 'import';

export interface RecordConsentInput {
  organizationId: string;
  guestId: string;
  consentKind: ConsentKind | string;
  /** Версія ТЕКСТУ, на який погодились. Без неї згода не доводить нічого. */
  version: string;
  source: ConsentSource | string;
}

export interface ConsentRow {
  version: string;
  source: string;
  givenAt: string;
  revokedAt: string | null;
}

/**
 * Гість цього орендаря — або названа відмова.
 *
 * Порожньо тут означає «не наш» і на Postgres, і на SQLite, але з різних
 * причин: там політика не показує чужого рядка, тут його відсікає умова. Обидві
 * дороги ведуть в одне місце навмисно — інваріант 13: перевірка, яка не
 * знайшла рядка, ВІДМОВЛЯЄ, а не дозволяє.
 */
async function ourGuest(organizationId: string, guestId: string): Promise<void> {
  const sql = getSql();
  const row = await sql.row<{ id: string }>(
    'SELECT id FROM guests WHERE id = ? AND organization_id = ?', [guestId, organizationId]);
  if (!row) refuse('Гостя не знайдено', 404);
}

/**
 * Записати згоду.
 *
 * Версія звіряється з довідником НАЗВАНОЮ відмовою, а не зовнішнім ключем:
 * текст існує в кількох мовах, тож унікальним у довіднику є (організація, рід,
 * версія, мова), а згода називає версію без мови — людина погодилась на
 * редакцію, а не на переклад. Довід повністю — у шапці міграції 0300.
 */
export async function recordConsent(input: RecordConsentInput): Promise<void> {
  const sql = getSql();
  await ourGuest(input.organizationId, input.guestId);

  // `is_active` тут не прикраса: знята з обігу редакція далі ДОВОДИТЬ старі
  // згоди (рядки на неї посилаються й лишаються чинними), але нову згоду на неї
  // взяти вже не можна — інакше «ми оновили текст» нічого не означало б.
  const text = await sql.row<{ id: string }>(
    `SELECT id FROM consent_texts
      WHERE organization_id = ? AND consent_kind = ? AND version = ? AND is_active = TRUE
      LIMIT 1`,
    [input.organizationId, input.consentKind, input.version]);
  if (!text) {
    refuse(`Немає чинного тексту згоди «${input.consentKind}» версії «${input.version}»`, 400);
  }

  // `organization_id` названий явно (інваріант 12): DEFAULT від контексту —
  // механізм Postgres, а на SQLite рядок дістав би NULL-орендаря беззвучно.
  await sql.run(
    `INSERT INTO guest_consents (id, organization_id, guest_id, consent_kind, version, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`gcs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      input.organizationId, input.guestId, input.consentKind, input.version, input.source]);
}

/**
 * Відкликати згоду — проставити `revoked_at`, а не видалити рядок.
 *
 * Рядка, якого немає, не досить В ОБИДВА боки: він не доводить ні того, що
 * згода була, ні того, що її знято. Наглядачеві показують саме пару дат.
 *
 * Відкликаються ВСІ живі рядки цього роду, а не «останній»: якщо їх чомусь
 * кілька (два шляхи запису, злиття гостей), лишити хоч один живим означало б
 * і далі слати листи людині, яка відмовилась.
 */
export async function revokeConsent(input: {
  organizationId: string; guestId: string; consentKind: ConsentKind | string;
}): Promise<void> {
  const sql = getSql();
  await ourGuest(input.organizationId, input.guestId);
  await sql.run(
    `UPDATE guest_consents SET revoked_at = CURRENT_TIMESTAMP
      WHERE organization_id = ? AND guest_id = ? AND consent_kind = ? AND revoked_at IS NULL`,
    [input.organizationId, input.guestId, input.consentKind]);
}

/**
 * Стан згод особи: рід → рядок, який ВИРІШУЄ.
 *
 * Живий рядок перемагає відкликаний, бо саме він дозволяє; серед живих —
 * найпізніший. Якщо живих немає, повертається найпізніший відкликаний, щоб
 * було видно пару дат. Порядок дописаний до самого кінця (`id`), бо
 * твердження про «останній» на рушії з іншим порядком рядків при рівних
 * ключах читалося б інакше (INC-027).
 */
export async function consentState(
  organizationId: string, guestId: string,
): Promise<Record<string, ConsentRow>> {
  const sql = getSql();
  const rows = await sql.rows<{
    consent_kind: string; version: string; source: string;
    given_at: string; revoked_at: string | null;
  }>(
    `SELECT consent_kind, version, source, given_at, revoked_at
       FROM guest_consents
      WHERE organization_id = ? AND guest_id = ?
      ORDER BY consent_kind,
               CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END,
               given_at DESC, id DESC`,
    [organizationId, guestId]);

  const state: Record<string, ConsentRow> = {};
  for (const row of rows) {
    if (state[row.consent_kind]) continue;   // перший у своєму роді і є вирішальним
    state[row.consent_kind] = {
      version: String(row.version),
      source: String(row.source),
      givenAt: String(row.given_at),
      revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
    };
  }
  return state;
}

/**
 * Чи можна цій людині слати листи.
 *
 * Питання про КІЛЬКІСТЬ живих рядків, а не про значення першого знайденого:
 * рядків може бути кілька, і на рушії з іншим порядком «перший» — інший
 * (AGENTS §7, INC-027). Живий рядок є — можна; немає жодного — не можна.
 */
export async function marketingAllowed(organizationId: string, guestId: string): Promise<boolean> {
  const sql = getSql();
  const row = await sql.row<{ n: number }>(
    `SELECT COUNT(*) AS n FROM guest_consents
      WHERE organization_id = ? AND guest_id = ?
        AND consent_kind = 'marketing' AND revoked_at IS NULL`,
    [organizationId, guestId]);
  return Number(row?.n ?? 0) > 0;
}
