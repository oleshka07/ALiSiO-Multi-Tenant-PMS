'use client';

/**
 * Setup progress на дашборді (MASTER-PLAN §1.4): вісім кроків онбордингу
 * обʼєкта, поки не всі зроблено. Стан приходить з
 * `/api/properties/[id]/setup-progress` — виведений із даних, не збережений.
 * Кожен крок веде на екран, де його роблять.
 *
 * Область — з провайдера (`usePropertyScope`), обʼєкт тут не обирається:
 * обраний обʼєкт дає одну картку; «Усі обʼєкти» — по картці на кожен обʼєкт,
 * якому ще щось лишилось, з його назвою в заголовку. Обʼєкт, у якого все
 * зроблено, картки не має.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import { useT } from '@core/i18n/client';
import { usePropertyScope, type ScopedProperty } from '@/ui/PropertyScopeContext';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';
import { LodgingBillingHint } from '@/modules/channels/ui/LodgingBillingHint';

interface Step { key: string; done: boolean; href: string }
interface Progress { steps: Step[]; done: number; total: number; lodgingKind: string | null }

const STEP_LABELS: Record<string, string> = {
  property: 'Обʼєкт: адреса, країна, час заїзду та виїзду, рід житла',
  rooms: 'Типи номерів і номери',
  seasons: 'Сезони',
  ratePlans: 'Тарифи',
  prices: 'Ціни на рік уперед без дір',
  taxes: 'Податки і збори',
  firstBooking: 'Перша бронь',
  channelOrSite: 'Канал або сайт',
};

export default function SetupProgressCard() {
  const { propertyId, properties } = usePropertyScope();
  const scoped = propertyId ? properties.filter((p) => p.id === propertyId) : properties;
  const ids = scoped.map((p) => p.id).join(',');
  const [progress, setProgress] = useState<Record<string, Progress>>({});

  useEffect(() => {
    if (!ids) return;
    let alive = true;
    Promise.all(
      ids.split(',').map((id) =>
        fetch(`/api/properties/${encodeURIComponent(id)}/setup-progress`)
          .then((r) => (r.ok ? r.json() : null))
          .then((p: Progress | null) => [id, p] as const)
          .catch(() => [id, null] as const),
      ),
    ).then((pairs) => {
      if (!alive) return;
      const next: Record<string, Progress> = {};
      for (const [id, p] of pairs) if (p) next[id] = p;
      setProgress(next);
    });
    return () => { alive = false; };
  }, [ids]);

  const pending = scoped.filter((p) => progress[p.id] && progress[p.id].done < progress[p.id].total);
  if (pending.length === 0) return null;

  return (
    <>
      {pending.map((p) => (
        <PropertySetupCard key={p.id} property={p} progress={progress[p.id]} named={scoped.length > 1} />
      ))}
    </>
  );
}

function PropertySetupCard({ property, progress, named }: { property: ScopedProperty; progress: Progress; named: boolean }) {
  const t = useT();
  const { features } = useCurrentUser();
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
          {t('Налаштування готелю')}{named ? ` · ${property.name}` : ''}
        </h3>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{progress.done}/{progress.total}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ width: `${(progress.done / progress.total) * 100}%`, height: '100%', background: 'var(--accent-primary)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 }}>
        {progress.steps.map((s, i) => (
          <Link
            key={s.key}
            href={s.href}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)',
              color: s.done ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: 'none',
              background: s.done ? 'transparent' : 'var(--bg-tertiary)',
            }}
          >
            {s.done
              ? <CheckCircle2 size={16} style={{ color: 'var(--accent-success)', flexShrink: 0 }} />
              : <Circle size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
            <span style={{ flex: 1, fontSize: 13, textDecoration: s.done ? 'line-through' : 'none' }}>
              {i + 1}. {t(STEP_LABELS[s.key] ?? s.key)}
            </span>
            {!s.done && <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />}
          </Link>
        ))}
      </div>
      {/* Наслідок роду житла для рахунку каналу — В ОНБОРДИНГУ, не лише в
          налаштуваннях обʼєкта (В1). Тут його бачить той, хто заводить
          готель, і бачить ДО того, як дійде до екрана каналів: рід — вісь
          тарифікації вендора, а помітна помилка в ній буває лише випискою
          першого числа. Лише з модулем каналів: готель, який їх не купував,
          нічого про чужі тарифи знати не мусить. */}
      {features.channels && <LodgingBillingHint kind={progress.lodgingKind} />}
    </div>
  );
}
