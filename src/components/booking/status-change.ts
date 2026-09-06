'use client';

/**
 * Що сказати рецепції після `PATCH /api/bookings/[id] { status }`.
 *
 * Сервер відповідає кодами, а не реченнями, там, де причина має бути
 * перекладена (варта виселення з боргом, 0091); старі варти заселення
 * віддають готове речення в `error`. Одне місце читає обидві форми — інакше
 * кожен екран (настільний список, календар, телефон) тлумачив би по-своєму.
 */
export interface StatusChangeOutcome {
  ok: boolean;
  /** Речення для тосту чи alert; порожнє — нічого казати. */
  message: string;
  /** Проходить із попередженням (виселення з боргом під `warning`). */
  warning: boolean;
}

export function explainStatusChange(
  ok: boolean,
  data: { error?: string; warning?: string; balance?: number; currency?: string | null } | null | undefined,
  tUi: (s: string) => string,
): StatusChangeOutcome {
  const money = (n: unknown, c: unknown) => `${Number(n ?? 0).toLocaleString()} ${c ?? ''}`.trim();
  if (ok) {
    if (data?.warning === 'unpaid_balance') {
      return { ok: true, warning: true, message: `⚠️ ${tUi('Виселено з несплаченим залишком')}: ${money(data.balance, data.currency)}` };
    }
    if (data?.warning === 'unit_dirty') {
      return { ok: true, warning: true, message: `⚠️ ${tUi('Заселено в номер, який ще не прибрано')}` };
    }
    return { ok: true, warning: false, message: '' };
  }
  if (data?.error === 'checkout_balance_blocking') {
    return { ok: false, warning: false, message: `${tUi('Виселення заборонено: несплачений залишок')} ${money(data.balance, data.currency)}. ${tUi('Прийміть оплату на вкладці «Фінанси» або змініть політику обʼєкта.')}` };
  }
  return { ok: false, warning: false, message: data?.error || tUi('Не вдалося змінити статус') };
}
