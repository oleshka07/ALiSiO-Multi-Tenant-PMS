/**
 * Які записи історії лишає одна правка броні.
 *
 * ── Звідки правило ──────────────────────────────────────────────────────
 *
 * Власник відкрив «Історію змін» після того, як прийняв оплату і змінив
 * платника, і не побачив НІЧОГО. Вкладка була справна: вона просто не має
 * що показати, бо список подій складався зі стрічки `if`-ів прямо в
 * обробнику PATCH і містив рівно девʼять полів. Усе інше, що людина може
 * змінити на картці, зникало безслідно:
 *
 *   company_id                — хто платить (і чи фірма взагалі)
 *   rate_plan_id              — за яким прейскурантом продано
 *   lodging_discount_percent  — знижка і її причина
 *   breakfast_included        — що саме продано разом із ніччю
 *
 * Кожне з цих чотирьох — гроші або документ. «Хто поставив цій броні
 * фірму-платника» це питання, яке ставлять через місяць, коли фактура пішла
 * не туди, і відповідати на нього нічим.
 *
 * ── Чому окремою функцією, а не ще пʼятьма `if` на місці ────────────────
 *
 * Список подій — це ТВЕРДЖЕННЯ про повноту, і його треба вміти перевірити.
 * Усередині обробника воно недосяжне: обробник загорнутий у варту, яка
 * читає кукі. Тут — чиста функція від тіла запиту і двох знімків, і гейт
 * `history-actions.check` питає її прямо: «чи лишає слід поле, яким
 * рухають гроші».
 *
 * Тексти українською тут навмисно: це журнал ОПЕРАТОРА, він живе в базі
 * поруч зі знімками й читається тією мовою, якою його писали. Мова
 * документів (інваріант 19) — інша річ і сюди не заходить.
 */

/** Один запис журналу: рід дії плюс рядок для людини. */
export interface HistoryAction {
  action: string;
  details: string;
}

/** Знімок рядка броні до/після — рівно те, що читає `bookingSnapshot`. */
type Row = Record<string, unknown> | null | undefined;

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => Number(v) || 0;

/**
 * Тіло PATCH → перелік записів історії.
 *
 * `before` і `after` — знімки рядка; вони потрібні там, де сама лише назва
 * поля нічого не каже людині (id фірми в журналі — це не відповідь).
 */
export function historyActionsFor(
  body: Record<string, unknown>,
  before: Row,
  after: Row,
): HistoryAction[] {
  const out: HistoryAction[] = [];
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  if (body.status) out.push({ action: 'status_change', details: `Статус → ${txt(body.status)}` });
  if (body.payment_status) out.push({ action: 'payment_status_change', details: `Оплата → ${txt(body.payment_status)}` });
  if (has('total_price')) {
    out.push({ action: 'price_change', details: `Ціна → ${txt(body.total_price)} ${txt(before?.currency)}`.trim() });
  }
  if (has('adults') || has('children')) {
    const was = `${txt(before?.adults) || '—'}+${num(before?.children)}`;
    const now = `${txt(body.adults ?? before?.adults) || '—'}+${num(body.children ?? before?.children)}`;
    out.push({ action: 'guests_change', details: `Гості: ${was} → ${now}` });
  }
  if (has('unit_id')) {
    // Назву номера підставляє викликач: вона потребує запиту в `units`, а ця
    // функція нічого не читає — саме тому її можна перевірити.
    out.push({ action: 'unit_change', details: `Юніт: ${txt(before?.unit_code) || '—'} → ${txt(body.unit_id)}` });
  }
  if (body.check_in || body.check_out) {
    out.push({ action: 'dates_change', details: `Дати: ${txt(body.check_in) || '—'} — ${txt(body.check_out) || '—'}` });
  }
  if (has('notes')) out.push({ action: 'notes_change', details: 'Нотатки змінено' });
  if (has('internal_notes')) out.push({ action: 'internal_notes_change', details: 'Внутрішні нотатки змінено' });
  if (body.registration_status) {
    out.push({ action: 'registration_change', details: `Реєстрація → ${txt(body.registration_status)}` });
  }

  // ── Далі — те, чого в журналі не було ────────────────────────────────

  // Платник. Пишеться НАЗВА, а не ідентифікатор: «company_id → 8f53…» це не
  // відповідь на питання «на кого пішла фактура». Знімок `after` уже містить
  // переписані сервером реквізити (Д79), тож назву беремо звідти.
  if (has('company_id') || has('invoice_company_name')) {
    const was = txt(before?.invoice_company_name);
    const now = txt(after?.invoice_company_name);
    if (was !== now) {
      out.push({
        action: 'payer_change',
        details: now ? `Платник → ${now}` : `Платник → гість${was ? ` (було: ${was})` : ''}`,
      });
    }
  }

  // Прейскурант: за яким тарифом продано ніч. Змінюється разом із ціною, і
  // саме тому має бути видно окремо — інакше «ціна змінилась» без причини.
  if (has('rate_plan_id')) {
    const now = txt(body.rate_plan_id);
    out.push({ action: 'rate_plan_change', details: now ? `Прейскурант → ${now}` : 'Прейскурант знято' });
  }

  // Знижка: відсоток і причина. Причина без відсотка і відсоток без причини
  // однаково нічого не пояснюють, тож рядок один.
  if (has('lodging_discount_percent') || has('lodging_discount_reason')) {
    const pct = has('lodging_discount_percent') ? num(body.lodging_discount_percent) : num(before?.lodging_discount_percent);
    const why = has('lodging_discount_reason') ? txt(body.lodging_discount_reason) : txt(before?.lodging_discount_reason);
    out.push({
      action: 'discount_change',
      details: pct > 0 ? `Знижка → ${pct}%${why ? ` · ${why}` : ''}` : 'Знижку знято',
    });
  }

  // Сніданок: три стани, і «за правилом готелю» це теж рішення.
  if (has('breakfast_included')) {
    const v = body.breakfast_included;
    out.push({
      action: 'breakfast_change',
      details: v === null || v === undefined || v === ''
        ? 'Сніданок → за правилом готелю'
        : (v === true || v === 1 || v === '1' ? 'Сніданок → входить у ціну' : 'Сніданок → не входить'),
    });
  }

  return out;
}
