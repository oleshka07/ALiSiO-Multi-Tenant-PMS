'use client';

import Link from 'next/link';
import { CreditCard } from 'lucide-react';
import { useT } from '@core/i18n/client';

/**
 * «Онлайн-оплата не підключена» — and the way to change that.
 *
 * One component, used in every place the product used to imply it could take
 * cards: the sites list, the site's own screens, the thank-you and
 * notification tabs. Before this, each of those places carried its own
 * sentence about Teya — a gateway deleted on 2026-08-22 — and a hotel reading
 * them would reasonably conclude that money was already arriving.
 *
 * The reason it is a component rather than a sentence copied four times is the
 * same reason CLAUDE.md gives for one rules file: four copies of a claim drift,
 * and then nobody knows which of them is current. When a gateway ships, the
 * text changes here and everywhere at once.
 *
 * `where` names the screen it is standing on, so the sentence reads as an
 * answer to what the operator was just looking at rather than a generic notice.
 *
 * `compact` drops the frame and the explanation, leaving the one button. It is
 * for screens that have already said the same thing in their own words — the
 * «Модулі та інтеграції» row for `online_payments`, where repeating the whole
 * paragraph under a toggle would push the other integrations off the screen.
 */
export const PAYMENTS_SETTINGS_HREF = '/app/settings/payments';

export default function PaymentGatewayNotice({ where, compact }: { where?: string; compact?: boolean }) {
  const t = useT();

  // Одне речення на кнопці, одне й те саме всюди. Оператор шукає не «шлюз» —
  // він шукає, де ввімкнути оплату для СВОГО готелю, і кнопка має називатись
  // так, як він про це думає.
  const cta = (
    <Link
      href={PAYMENTS_SETTINGS_HREF}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium"
    >
      <CreditCard size={14} /> {t('Налаштуйте оплати для вашого готелю')}
    </Link>
  );

  if (compact) return cta;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start gap-3">
        <CreditCard size={20} className="text-gray-400 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <div className="font-medium">{t('Онлайн-оплата не підключена')}</div>
          <p className="text-sm text-gray-400">
            {where
              ? `${t(where)} ${t('приймає оплату на місці або за рахунком.')}`
              : t('Готель приймає оплату на місці або за рахунком.')}
            {' '}
            {t('Щоб приймати картки, оберіть свій платіжний шлюз — Stripe, PayPal, Teya — і збережіть його ключі.')}
          </p>
          {cta}
        </div>
      </div>
    </div>
  );
}
