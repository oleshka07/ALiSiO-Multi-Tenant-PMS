'use client';

/**
 * Екран, який працює з рівно одним обʼєктом.
 *
 * Тарифи, ціни, майстер каналів, гостьова сторінка, номерний фонд — усе це
 * пишеться на конкретний готель, і «Усі обʼєкти» тут не має сенсу. Замість
 * мовчазного першого (так було: `setPropertyId(arr[0].id)`) екран просить
 * обрати, і вибір діє на всю оболонку — його видно в шапці. Організації без
 * жодного обʼєкта екран каже, куди йти.
 *
 * З одним обʼєктом область завжди він, і ця обгортка прозора.
 */

import Link from 'next/link';
import { useT } from '@core/i18n/client';
import { Building2 } from 'lucide-react';
import { usePropertyScope } from '@/ui/PropertyScopeContext';

export default function PropertyRequired({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { properties, propertyId, setPropertyId } = usePropertyScope();

  if (propertyId) return <>{children}</>;

  if (properties.length === 0) {
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Building2 size={18} /> {t('Спершу заведіть обʼєкт')}
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {t('В організації ще немає жодного обʼєкта розміщення. Цей екран не має з чим працювати, поки його не буде.')}
        </p>
        <Link href="/app/settings/properties" className="btn btn-primary btn-sm">{t('До обʼєктів')}</Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Building2 size={18} /> {t('Оберіть обʼєкт')}
      </h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
        {t('Цей екран працює з одним обʼєктом, а зараз обрано «Усі обʼєкти». Вибір діє на всі екрани — його видно в шапці.')}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {properties.map((p) => (
          <button key={p.id} type="button" className="btn btn-secondary" onClick={() => setPropertyId(p.id)}>{p.name}</button>
        ))}
      </div>
    </div>
  );
}
