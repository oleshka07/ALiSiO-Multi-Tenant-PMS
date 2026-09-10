/**
 * Підпис пальцем під реєстрацією — єдині двері, якими він потрапляє в базу.
 *
 * ── Що це і чому воно взагалі є ─────────────────────────────────────────
 *
 * Рішення власника К3 (Блок «Кіоск», 10.09.2026): іноземець на терміналі
 * підписує Meldeschein пальцем; для громадянина ФРН Meldeschein не потрібен,
 * і підпису теж немає. Тобто підпис — не поле форми, а ДОКАЗ: ця людина в
 * цьому перебуванні підтвердила свої дані. Тому він лежить на рядку
 * реєстрації (`guest_registrations`, 0410), а не на гостеві: той самий
 * чоловік наступного року підписує заново.
 *
 * ── Чому «лише фасадом» — і що це означає на ділі ───────────────────────
 *
 * Колонку можна було б дописати в `saveRegistrations` і приймати з тіла
 * запиту разом з іменем. Саме так у цю систему вже потрапляли поля, яких
 * ніхто не перевіряв. Підпис — 200-кілобайтний рядок, який приймає ПУБЛІЧНИЙ
 * маршрут: без окремих дверей його розмір і форму довелось би перевіряти в
 * кожному місці, звідки він приходить (кіоск, портал, рецепція), і третє
 * місце забуло б.
 *
 * Тут перевіряється рівно три речі, і кожна — відмовою, а не 500-кою:
 *
 *   форма   — `data:image/png;base64,…` і нічого іншого. SVG вміє скрипт,
 *             а цей рядок ми колись покажемо в `<img>` на сторінці рецепції;
 *   розмір  — ≤ 200 КБ (§3.1). Палець на 86-дюймовому екрані малює довгу
 *             криву, і полотно 4K віддало б мегабайти;
 *   адресат — реєстрація ЦІЄЇ броні цієї організації. Чужий id → «немає»
 *             (інваріант 5).
 *
 * Знеособлення окремого правила не потребує: GDPR-ретенція видаляє рядки
 * `guest_registrations` минулих перебувань цілком (`deleteConsentLog` у
 * `registration.repo.ts`), тож підпис іде разом із рештою.
 */
import { getSql } from '@core/db/async';

/** §3.1: не більше 200 КБ. Рахуються БАЙТИ рядка, а не символи. */
export const SIGNATURE_MAX_BYTES = 200 * 1024;

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export type SignatureRefusal = 'not_found' | 'not_png' | 'too_large';

export type SignatureAnswer =
  | { ok: true; signedAt: string; registrationId: string }
  | { ok: false; refusal: SignatureRefusal };

/**
 * Записати підпис під реєстрацією броні.
 *
 * `registrationId` не передається: підписує ПЕРШИЙ гість броні (той, чий
 * рядок `is_primary`), бо Meldeschein підписує заявник за все перебування.
 * Коли зʼявиться юрисдикція, де підписує кожен, це стане аргументом — і
 * тоді ж, а не «про всяк випадок» зараз.
 */
export async function saveSignature(input: {
  organizationId: string;
  /**
   * Будинок, у якому діє писач. Обовʼязковий з тієї самої причини, що у
   * фасадах заселення: термінал стоїть у холі ОДНОГО корпусу, а вісь
   * орендаря двох корпусів одного рахунку не розрізняє (INC-029). Підпис
   * під реєстрацією сусіднього будинку — це чужий доказ у чужій книзі.
   */
  propertyId: string;
  reservationId: string;
  /** `data:image/png;base64,…` — те, що віддає `canvas.toDataURL('image/png')`. */
  signaturePng: string;
}): Promise<SignatureAnswer> {
  const png = (input.signaturePng ?? '').trim();
  if (!PNG_DATA_URL.test(png)) return { ok: false, refusal: 'not_png' };
  if (Buffer.byteLength(png, 'utf8') > SIGNATURE_MAX_BYTES) return { ok: false, refusal: 'too_large' };

  const sql = getSql();

  // Організація — через бронь, а не з тіла: `guest_registrations` своєї
  // колонки орендаря не має, вона висить на броні (інваріант 12 — орендар
  // береться підзапитом від рядка, на якому висить).
  const row = await sql.row<{ id: string }>(`
    SELECT gr.id
      FROM guest_registrations gr
      JOIN reservations r ON r.id = gr.reservation_id
     WHERE gr.reservation_id = ? AND r.organization_id = ? AND r.property_id = ?
     ORDER BY gr.is_primary DESC, gr.created_at
  `, [input.reservationId, input.organizationId, input.propertyId]);
  if (!row) return { ok: false, refusal: 'not_found' };

  const signedAt = new Date().toISOString();
  await sql.run(
    'UPDATE guest_registrations SET signature_png = ?, signed_at = ? WHERE id = ?',
    [png, signedAt, row.id],
  );
  return { ok: true, signedAt, registrationId: row.id };
}

/**
 * Чи підписана реєстрація цієї броні. Питання кіоска перед заселенням
 * іноземця — і рецепції, коли вона друкує Meldeschein.
 */
export async function isSigned(
  organizationId: string,
  propertyId: string,
  reservationId: string,
): Promise<boolean> {
  const row = await getSql().row<{ signed_at: string | null }>(`
    SELECT gr.signed_at
      FROM guest_registrations gr
      JOIN reservations r ON r.id = gr.reservation_id
     WHERE gr.reservation_id = ? AND r.organization_id = ? AND r.property_id = ?
       AND gr.signed_at IS NOT NULL
     LIMIT 1
  `, [reservationId, organizationId, propertyId]);
  return !!row?.signed_at;
}
