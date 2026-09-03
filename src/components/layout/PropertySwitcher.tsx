'use client';

/**
 * Перемикач обʼєкта в шапці — єдиний елемент, який міняє область.
 *
 * Зʼявляється лише коли є з чого обирати (два обʼєкти й більше): з одним
 * готелем область завжди він, і зайвий елемент у шапці 77 екранів лише
 * питав би про те, на що є одна відповідь. Пункт «Усі обʼєкти» — для
 * списків (заїзди, броні, звіти); екран налаштувань його не приймає і
 * просить обрати (`PropertyRequired`). Див. `src/ui/PropertyScopeContext.tsx`.
 */

import { useT } from '@core/i18n/client';
import { Building2 } from 'lucide-react';
import { usePropertyScope, ALL_PROPERTIES } from '@/ui/PropertyScopeContext';

export default function PropertySwitcher({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const { properties, propertyId, setPropertyId } = usePropertyScope();
  if (properties.length < 2) return null;

  return (
    <label title={t('Обʼєкт')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      {!compact && <Building2 size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
      <select
        className="form-select"
        aria-label={t('Обʼєкт')}
        value={propertyId ?? ALL_PROPERTIES}
        onChange={(e) => setPropertyId(e.target.value === ALL_PROPERTIES ? null : e.target.value)}
        style={{
          width: 'auto',
          maxWidth: compact ? 132 : 220,
          padding: compact ? '5px 26px 5px 8px' : '6px 30px 6px 10px',
          fontSize: compact ? 12 : 13,
          fontWeight: 600,
        }}
      >
        <option value={ALL_PROPERTIES}>{t('Усі обʼєкти')}</option>
        {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}
