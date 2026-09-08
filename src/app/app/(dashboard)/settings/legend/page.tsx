'use client';

/**
 * Легенда (Hoteliera «Legend», MASTER-PLAN §1.2): що означають кольори й
 * статуси на планері, у списку броней і на дашборді.
 *
 * Кольори — ЛИШЕ з токенів `globals.css` (`--status-*`, `--accent-*`): це та
 * сама палітра, що малює смуги в планері, тож легенда не може розійтися з
 * екраном і однаково правдива в обох темах (П18).
 */
import { useRouter } from 'next/navigation';
import { useT } from '@core/i18n/client';
import Header from '@/components/layout/Header';

interface LegendRow { token: string; label: string; desc: string }

const BOOKING_STATUSES: LegendRow[] = [
  { token: '--status-draft', label: 'Чернетка', desc: 'Бронь ще не підтверджена: місце не блокується для продажу' },
  { token: '--status-tentative', label: 'Очікується', desc: 'Створена, чекає на підтвердження або оплату; номер уже не продається' },
  { token: '--status-confirmed', label: 'Підтверджено', desc: 'Гість приїде; бронь рахується в заїздах' },
  { token: '--status-checked-in', label: 'Заселено', desc: 'Гість у домі' },
  { token: '--status-checked-out', label: 'Виселено', desc: 'Перебування завершене; номер чекає прибирання' },
  { token: '--status-cancelled', label: 'Скасовано', desc: 'Бронь скасована — не рахується ні в заїздах, ні в наявності' },
  { token: '--status-no-show', label: 'Не приїхав', desc: 'Гість не зʼявився; номер знову у продажу' },
];

const PAYMENT_STATUSES: LegendRow[] = [
  { token: '--accent-danger', label: 'Не оплачено', desc: 'Жодної оплати ще немає' },
  { token: '--accent-warning', label: 'Запит на оплату', desc: 'Гостю надіслано посилання чи рахунок, оплата не надійшла' },
  { token: '--accent-info', label: 'Передплата', desc: 'Частину сплачено; залишок — при заїзді' },
  { token: '--accent-success', label: 'Оплачено', desc: 'Сплачено повністю' },
];

const CLEANING_STATUSES: LegendRow[] = [
  { token: '--accent-success', label: 'Прибрано', desc: 'Номер готовий до заселення' },
  { token: '--accent-danger', label: 'Брудно', desc: 'Після виїзду, прибирання ще не починалось' },
  { token: '--accent-warning', label: 'Прибирається', desc: 'Покоївка в номері' },
];

function Swatch({ token }: { token: string }) {
  return <span aria-hidden style={{ width: 16, height: 16, borderRadius: 4, background: `var(${token})`, flexShrink: 0, display: 'inline-block' }} />;
}

function Table({ rows, t }: { rows: LegendRow[]; t: (s: string) => string }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table className="table" style={{ margin: 0 }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td style={{ width: 40 }}><Swatch token={r.token} /></td>
              <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{t(r.label)}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{t(r.desc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LegendPage() {
  const t = useT();
  const router = useRouter();
  return (
    <>
      <Header onBack={() => router.push('/app/settings')} />
      <div className="app-content" style={{ maxWidth: 900 }}>
        <div className="page-header">
          <div>
            <h2 className="page-title">{t('Легенда')}</h2>
            <div className="page-subtitle">{t('Що означають кольори й статуси на планері, у бронях і на дашборді')}</div>
          </div>
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>{t('Статус броні')}</h3>
        <Table rows={BOOKING_STATUSES} t={t} />

        <h3 style={{ fontSize: 14, fontWeight: 700, margin: '24px 0 8px' }}>{t('Оплата')}</h3>
        <Table rows={PAYMENT_STATUSES} t={t} />

        <h3 style={{ fontSize: 14, fontWeight: 700, margin: '24px 0 8px' }}>{t('Прибирання')}</h3>
        <Table rows={CLEANING_STATUSES} t={t} />

        <h3 style={{ fontSize: 14, fontWeight: 700, margin: '24px 0 8px' }}>{t('На планері')}</h3>
        <div className="card" style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <div><strong style={{ color: 'var(--text-primary)' }}>{t('Смуга «Без номера»')}</strong> — {t('бронь із каналу лягла на тип номера, кімнату ще не призначено: перетягніть її на вільний номер')}</div>
          <div><strong style={{ color: 'var(--text-primary)' }}>{t('Число під клітинкою')}</strong> — {t('ціна ночі за базовим тарифом; порожньо — ціни на цей день немає, ніч не продається')}</div>
          <div><strong style={{ color: 'var(--text-primary)' }}>{t('Лічильник на «Планері» в меню')}</strong> — {t('скільки броней у чорновику чекають на рішення')}</div>
        </div>
      </div>
    </>
  );
}
