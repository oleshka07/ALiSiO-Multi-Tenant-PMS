'use client';

import { useT } from '@core/i18n/client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ListChecks, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react';

interface DashboardSummary {
  tasks: { id: string; title: string; severity: string }[];
  exceptions: { id: string; title: string; severity: string }[];
}

export default function ReconcileWidget() {
  const tUi = useT();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/finance/reconcile')
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!data) return null;

  const taskCount = data.tasks?.length || 0;
  const exceptionCount = data.exceptions?.length || 0;
  const isClean = taskCount === 0 && exceptionCount === 0;

  return (
    <Link href="/app/finance/reconcile" style={{
      display: 'block', padding: 16, marginBottom: 24,
      background: isClean ? 'rgba(34,197,94,0.06)' : 'rgba(245,158,11,0.06)',
      border: `1px solid ${isClean ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
      borderRadius: 12, textDecoration: 'none', color: 'var(--text-primary)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {isClean ? (
          <CheckCircle2 size={24} color="#22c55e" />
        ) : (
          <ListChecks size={24} color="#f59e0b" />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
            Reconciliation Inbox
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {isClean ? (
              <>{tUi('🎉 Все чисто — задач і exceptions немає')}</>
            ) : (
              <>
                {taskCount > 0 && (
                  <span style={{ color: '#3b82f6', fontWeight: 600 }}>
                    {taskCount} task{taskCount === 1 ? '' : 's'}
                  </span>
                )}
                {taskCount > 0 && exceptionCount > 0 && ' · '}
                {exceptionCount > 0 && (
                  <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                    <AlertCircle size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
                    {exceptionCount} exception{exceptionCount === 1 ? '' : 's'}
                  </span>
                )}
                {' '}{tUi('— перейди й розбери')}
              </>
            )}
          </div>
        </div>
        <ExternalLink size={14} color="var(--text-secondary)" />
      </div>

      {!isClean && (taskCount > 0 || exceptionCount > 0) && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}>
          {data.tasks.slice(0, 3).map((t) => (
            <div key={t.id} style={{ marginBottom: 4 }}>
              <span style={{ color: '#3b82f6', marginRight: 6 }}>●</span> {t.title}
            </div>
          ))}
          {data.exceptions.slice(0, 3).map((e) => (
            <div key={e.id} style={{ marginBottom: 4 }}>
              <span style={{ color: '#f59e0b', marginRight: 6 }}>●</span> {e.title}
            </div>
          ))}
          {(data.tasks.length + data.exceptions.length > 6) && (
            <div style={{ fontStyle: 'italic', marginTop: 4 }}>
              {tUi('+ ще')} {data.tasks.length + data.exceptions.length - 6} →
            </div>
          )}
        </div>
      )}
    </Link>
  );
}
