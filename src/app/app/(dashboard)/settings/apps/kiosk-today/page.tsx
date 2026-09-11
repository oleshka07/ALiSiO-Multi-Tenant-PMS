'use client';

/**
 * «Kiosk heute» — що термінали зробили за ДОБУ ГОТЕЛЮ.
 *
 * Той самий підсумок, що йде листом о 7:00 (`today-mail.ts`), і рахує його те
 * саме місце (`today.repo.ts`). Якби екран рахував сам, він розійшовся б із
 * листом при першій же правці, і рецепція бачила б у пошті одне, а на екрані
 * інше — про ті самі виїзди.
 *
 * Доба — ГОТЕЛЮ, не UTC: заселення о 00:40 місцевого часу взимку в Берліні
 * припадає на 23:40 UTC попередньої доби, і «нуль заселень» у ранок після
 * зміни, коли їх було троє, — це не дрібниця обліку.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useT } from '@core/i18n/client';
import { usePropertyScope } from '@/ui/PropertyScopeContext';

interface Event {
  id: string;
  device_name: string | null;
  reservation_id: string | null;
  kind: string;
  result: string;
  detail: string | null;
  at: string;
}

interface Day {
  day: string;
  timezone: string;
  events: Event[];
  counts: { checkedIn: number; registered: number; checkedOut: number; ordered: number; errors: number };
  invoiceElsewhere: Event[];
}

/**
 * Слово події — мапою, а не `t(kind)`.
 *
 * `kiosk_events.kind` — вільний рядок (NAMING): словник подій росте швидше за
 * міграції. Невідоме слово показується ЯК Є, а не ховається: подія, якої
 * екран не знає, все одно сталася, і мовчазний пропуск зробив би підсумок
 * неправдивим.
 */
const KIND: Record<string, string> = {
  pair: 'спарувався',
  search: 'знайшов бронь',
  search_miss: 'не знайшов',
  search_ambiguous: 'кілька збігів',
  register: 'зареєстрував',
  sign: 'підписав',
  checkin: 'заселився',
  checkout: 'виїхав',
  order: 'замовив',
  invoice_elsewhere: 'фактуру виставити в чужій системі',
  walkin_claim: 'walk-in',
};

export default function KioskTodayPage() {
  const t = useT();
  const { propertyId } = usePropertyScope();
  const [data, setData] = useState<Day | null>(null);
  const [day, setDay] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (propertyId) params.set('property_id', propertyId);
      if (day) params.set('day', day);
      const res = await fetch(`/api/settings/apps/kiosk/today?${params.toString()}`);
      setData(res.ok ? ((await res.json()) as Day) : null);
    } finally { setLoading(false); }
  }, [propertyId, day]);

  useEffect(() => { void load(); }, [load]);

  const counts = data?.counts;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <Link href="/app/settings/apps" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <ArrowLeft size={16} /> {t('Застосунки')}
      </Link>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>{t('Kiosk heute')}</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        {t('Доба готелю')} {data ? `${data.day} · ${data.timezone}` : ''}
      </p>

      <input
        type="date"
        value={day}
        onChange={(e) => setDay(e.target.value)}
        style={{ marginBottom: 16, padding: '6px 8px' }}
        data-testid="kiosk-today-day"
      />

      {loading && <div>{t('Завантаження…')}</div>}

      {!loading && counts && (
        <>
          <div style={{ display: 'flex', gap: 18, marginBottom: 18, flexWrap: 'wrap' }} data-testid="kiosk-today-counts">
            {/*
              `t()` стоїть на самому ЛІТЕРАЛІ, а не на змінній нижче: витягач
              рядків читає код, а не виконує його, і `t(label)` лишив би
              каталог без цих пʼяти слів — тобто німецька картка показувала б
              українські підписи під числами.
            */}
            {([
              [t('Заселився'), counts.checkedIn],
              [t('Зареєстрував'), counts.registered],
              [t('Виїхав'), counts.checkedOut],
              [t('Замовив'), counts.ordered],
              [t('Помилки'), counts.errors],
            ] as const).map(([label, n]) => (
              <div key={label}>
                <div style={{ fontSize: 26, fontWeight: 600 }}>{n}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>

          {data!.invoiceElsewhere.length > 0 && (
            <div style={{ marginBottom: 18 }} data-testid="kiosk-today-invoices">
              <h2 style={{ fontSize: 15, marginBottom: 6 }}>{t('Виставити фактуру в чужій системі')}</h2>
              <ul style={{ fontSize: 13 }}>
                {data!.invoiceElsewhere.map((e) => (
                  <li key={e.id}>{e.reservation_id ?? '—'} · {e.at.slice(11, 16)}</li>
                ))}
              </ul>
            </div>
          )}

          {data!.events.length === 0
            ? <div style={{ color: 'var(--text-secondary)' }}>{t('За цю добу термінали нічого не робили')}</div>
            : (
              <table style={{ width: '100%', fontSize: 13 }}>
                <tbody>
                  {data!.events.map((e) => (
                    <tr key={e.id} data-testid="kiosk-today-event">
                      <td style={{ padding: '4px 8px 4px 0', color: 'var(--text-secondary)' }}>{e.at.slice(11, 16)}</td>
                      <td style={{ padding: '4px 8px 4px 0' }}>{e.device_name ?? '—'}</td>
                      <td style={{ padding: '4px 8px 4px 0' }}>{KIND[e.kind] ? t(KIND[e.kind]) : e.kind}</td>
                      <td style={{ padding: '4px 8px 4px 0', color: e.result === 'ok' ? 'inherit' : 'var(--danger)' }}>
                        {e.result === 'ok' ? '' : `${e.result}${e.detail ? ` · ${e.detail}` : ''}`}
                      </td>
                      <td style={{ color: 'var(--text-tertiary)' }}>{e.reservation_id ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </>
      )}
    </div>
  );
}
