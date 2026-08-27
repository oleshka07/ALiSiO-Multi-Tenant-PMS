'use client';

import { useState } from 'react';
import type { Translations, Lang } from '@/app/guest/[token]/translations';

const ALL_LANGS: Lang[] = ['en', 'de', 'cs', 'uk', 'pl', 'nl', 'fr'];
const LANG_LABELS: Record<Lang, string> = { en: 'EN', de: 'DE', cs: 'CZ', uk: 'UA', pl: 'PL', nl: 'NL', fr: 'FR' };

interface Props {
  data: any;
  t: Translations;
  lang: Lang;
  setLang?: (l: Lang) => void;
  /** Токен посилання — ним же підписаний запит «хочу оплатити». */
  token?: string;
}

export function PaymentGateScreen({ data, t, lang, setLang, token }: Props) {
  const r = data.reservation;

  // Стан кнопки «хочу оплатити». `asked` починає з правди в базі: якщо
  // адміністратор уже бачить запит, гість не має бачити кнопку, наче нічого не
  // сталося, і не має тиснути її вдруге.
  const [asked, setAsked] = useState(r?.payment_status === 'payment_requested');
  const [asking, setAsking] = useState(false);

  const askForInvoice = async () => {
    if (!token || asking || asked) return;
    setAsking(true);
    try {
      await fetch(`/api/guest/${token}/payment-request`, { method: 'POST' });
      // Показуємо «готель повідомлений» і на помилці теж. Гість не може нічого
      // вдіяти з нашою 500, а кнопка, яка після натиску виглядає ненатиснутою,
      // змусить його дзвонити — тобто зробити рівно те, чого ми уникали.
    } finally {
      setAsked(true);
      setAsking(false);
    }
  };

  const remaining = data.payments?.remaining ?? r?.total_price ?? 0;
  const currency = r?.currency || '';

  // Format date
  const fmt = (d: string) => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  };

  // Days until check-in
  const today = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00');
  const checkIn = new Date((r?.check_in || '') + 'T00:00:00');
  const dLeft = Math.max(0, Math.round((checkIn.getTime() - today.getTime()) / 86400000));

  const nights = r?.nights || 0;
  const guestName = r?.first_name || '';
  const unitName = r?.unit_name || '';

  // Locale labels
  const labels: Record<string, Record<string, string>> = {
    en: { banner: 'Complete payment to unlock full access', nights: 'nights', daysTo: `${dLeft} days to check-in`, bookedFor: 'Booking confirmed', howToPay: 'Payment is taken by the property — call or email us and we will confirm it here', remaining: 'Remaining', contact: 'Questions? Call us', locked: 'Available after payment', askPay: 'Ask the property for an invoice', asked: 'The property has been notified — they will be in touch' },
    de: { banner: 'Zahlung abschließen für vollständigen Zugang', nights: 'Nächte', daysTo: `${dLeft} Tage bis zum Check-in`, bookedFor: 'Buchung bestätigt', howToPay: 'Die Zahlung nimmt die Unterkunft entgegen — rufen Sie an oder schreiben Sie uns, wir bestätigen sie hier', remaining: 'Ausstehend', contact: 'Fragen? Rufen Sie uns an', locked: 'Verfügbar nach Zahlung', askPay: 'Rechnung bei der Unterkunft anfordern', asked: 'Die Unterkunft wurde benachrichtigt und meldet sich' },
    cs: { banner: 'Dokončete platbu pro plný přístup', nights: 'nocí', daysTo: `${dLeft} dní do příjezdu`, bookedFor: 'Rezervace potvrzena', howToPay: 'Platbu přijímá ubytovatel — zavolejte nebo napište, potvrdíme ji zde', remaining: 'Zbývá uhradit', contact: 'Dotazy? Zavolejte nám', locked: 'Dostupné po platbě', askPay: 'Požádat ubytovatele o fakturu', asked: 'Ubytovatel byl informován a ozve se vám' },
    uk: { banner: 'Завершіть оплату для повного доступу', nights: 'ночей', daysTo: `${dLeft} днів до заїзду`, bookedFor: 'Бронювання підтверджено', howToPay: 'Оплату приймає готель — зателефонуйте або напишіть, і ми підтвердимо її тут', remaining: 'До сплати', contact: 'Питання? Телефонуйте нам', locked: 'Доступно після оплати', askPay: 'Попросити рахунок у готелю', asked: 'Готель повідомлено — з вами звʼяжуться' },
    pl: { banner: 'Dokończ płatność, aby uzyskać pełny dostęp', nights: 'nocy', daysTo: `${dLeft} dni do zameldowania`, bookedFor: 'Rezerwacja potwierdzona', howToPay: 'Płatność przyjmuje obiekt — zadzwoń lub napisz, potwierdzimy ją tutaj', remaining: 'Pozostało', contact: 'Pytania? Zadzwoń do nas', locked: 'Dostępne po płatności', askPay: 'Poproś obiekt o fakturę', asked: 'Obiekt został powiadomiony i skontaktuje się z Tobą' },
    nl: { banner: 'Voltooi betaling voor volledige toegang', nights: 'nachten', daysTo: `${dLeft} dagen tot check-in`, bookedFor: 'Boeking bevestigd', howToPay: 'De accommodatie neemt de betaling aan — bel of mail ons, wij bevestigen het hier', remaining: 'Resterend', contact: 'Vragen? Bel ons', locked: 'Beschikbaar na betaling', askPay: 'Vraag de accommodatie om een factuur', asked: 'De accommodatie is op de hoogte en neemt contact op' },
    fr: { banner: 'Finalisez le paiement pour accès complet', nights: 'nuits', daysTo: `${dLeft} jours avant arrivée`, bookedFor: 'Réservation confirmée', howToPay: 'Le paiement est encaissé par l’établissement — appelez-nous ou écrivez-nous, nous le confirmerons ici', remaining: 'Reste à payer', contact: 'Questions ? Appelez-nous', locked: 'Disponible après paiement', askPay: 'Demander une facture à l’établissement', asked: 'L’établissement a été prévenu et vous recontactera' },
  };
  const L = labels[lang] || labels.en;

  return (
    <div className="gp-payment-gate">
      {/* Language pills */}
      {setLang && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '10px 16px 0' }}>
          {ALL_LANGS.map(l => (
            <button key={l} className={`gp-lang-pill ${l === lang ? 'active' : ''}`}
              onClick={() => setLang(l)}
              style={{ fontSize: 11, padding: '4px 8px', background: l === lang ? '#000' : 'rgba(0,0,0,0.4)', color: '#FFF' }}>{LANG_LABELS[l]}</button>
          ))}
        </div>
      )}

      {/* Banner */}
      <div className="gp-payment-banner">
        ⚠️ {L.banner}
      </div>

      {/* Wallet Card */}
      <div className="gp-wallet-card" style={{ margin: '0 16px 16px' }}>
        <div className="gp-wallet-unit">{unitName}</div>
        <div className="gp-wallet-dates">
          <div>
            <div className="gp-wallet-label">{t.checkIn}</div>
            <div className="gp-wallet-val">{fmt(r?.check_in)}</div>
          </div>
          <div className="gp-wallet-sep">→</div>
          <div>
            <div className="gp-wallet-label">{t.checkOut}</div>
            <div className="gp-wallet-val">{fmt(r?.check_out)}</div>
          </div>
          <div>
            <div className="gp-wallet-label">{t.nights}</div>
            <div className="gp-wallet-val">{nights}</div>
          </div>
        </div>
        <div className="gp-wallet-countdown">{L.daysTo}</div>
      </div>

      {/* Booking confirmed */}
      <div className="gp-pg-card">
        <div className="gp-pg-row">
          <span className="gp-pg-icon">✅</span>
          <span className="gp-pg-label">{L.bookedFor}</span>
        </div>
        {guestName && (
          <div className="gp-pg-row">
            <span className="gp-pg-icon">👤</span>
            <span className="gp-pg-label">{guestName}</span>
          </div>
        )}
        <div className="gp-pg-row">
          <span className="gp-pg-icon">🏠</span>
          <span className="gp-pg-label">{unitName} · {nights} {L.nights}</span>
        </div>
      </div>

      {/* Payment block */}
      <div className="gp-pg-card gp-pg-card--pay">
        <div className="gp-pg-remaining-label">{L.remaining}</div>
        <div className="gp-pg-remaining-amount">
          {Number(remaining).toLocaleString()} {currency}
        </div>

        {/*
          Тут мала бути кнопка «Оплатити»: рядок payBtn був написаний у семи
          мовах і не траплявся в JSX жодного разу. Кнопки не буде й далі —
          онлайн-шлюзу в продукті немає взагалі (`anyGatewayImplemented()` у
          core/payments.ts повертає false, і це не тимчасово).

          Тобто гість бачив «Завершіть оплату для повного доступу», під ним
          суму, під нею телефон — і жодного способу заплатити. Сторінка з
          вказівками, паркінгом і кодом від дверей лишалась замкненою.

          Тому екран тепер каже, ЩО робити, а не обіцяє дію, якої немає:
          оплату приймає готель, ось телефон і пошта.
        */}
        <div className="gp-pg-contact">{L.howToPay}</div>

        {/*
          Кнопка, яка НЕ бере грошей.

          Вона ставить броні `payment_status = 'payment_requested'`, і банер над
          списком броней показує адміністратору, що цей гість чекає на рахунок
          (`dashboard/domain/alerts.ts`). Раніше тут не було нічого, крім
          телефону: гість із іншої країни, який відкрив сторінку вночі, мав або
          дзвонити зранку, або лишити все як є.

          Це не заміна онлайн-оплати й не має на неї схожості: жодного «Оплатити»,
          жодних логотипів карток. Обіцяти можна тільки те, що станеться.
        */}
        {token && (
          <button
            type="button"
            onClick={askForInvoice}
            disabled={asked || asking}
            className="gp-pg-ask"
            style={{
              width: '100%', marginTop: 12, padding: '12px 16px', borderRadius: 12,
              border: '1px solid rgba(0,0,0,0.15)', cursor: asked ? 'default' : 'pointer',
              background: asked ? 'rgba(0,0,0,0.04)' : '#000',
              color: asked ? '#333' : '#FFF',
              fontSize: 14, fontWeight: 600, opacity: asking ? 0.6 : 1,
            }}
          >
            {asked ? `✅ ${L.asked}` : L.askPay}
          </button>
        )}

        {(r?.property_phone || r?.property_email) && (
          <div className="gp-pg-contact">
            {L.contact}:{' '}
            {r?.property_phone && <a href={`tel:${r.property_phone}`}>{r.property_phone}</a>}
            {r?.property_phone && r?.property_email && ' · '}
            {r?.property_email && <a href={`mailto:${r.property_email}`}>{r.property_email}</a>}
          </div>
        )}
      </div>

      {/* Locked features */}
      <div className="gp-pg-locked">
        {['🧭 ' + (t.directions || 'Directions'), '🚗 ' + (t.parking || 'Parking'), '🔑 ' + (t.entry || 'Entry'), '📶 Wi-Fi', '🛎 ' + (t.services || 'Services')].map((item, i) => (
          <div key={i} className="gp-pg-locked-item">
            <span>{item}</span>
            <span className="gp-pg-locked-badge">🔒 {L.locked}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
