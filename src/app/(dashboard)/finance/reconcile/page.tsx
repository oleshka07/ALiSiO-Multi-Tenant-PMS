'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ListChecks, AlertCircle, CheckCircle2, Upload, Mail, Repeat, Clock, Paperclip, RefreshCw, ExternalLink, TrendingUp, TrendingDown, Wallet } from 'lucide-react';

interface DashboardItem {
  id: string;
  severity: 'task' | 'warn' | 'error';
  icon: string;
  title: string;
  description: string;
  action_label: string;
  action_href: string;
}

interface DashboardData {
  tasks: DashboardItem[];
  exceptions: DashboardItem[];
  status: {
    outstanding: { currency: string; cnt: number; total: number }[];
    last_sync: {
      bank_inbox: string | null;
      receipt_inbox: string | null;
      teya: string | null;
      teya_result: { fetched: number; matched: number; created: number; from: string; to: string } | null;
    };
    month: {
      month: string;
      income_czk: number;
      expense_czk: number;
      net_czk: number;
      op_count: number;
    };
  };
}

function iconFor(name: string) {
  const props = { size: 16 };
  switch (name) {
    case 'upload': return <Upload {...props} />;
    case 'mail': return <Mail {...props} />;
    case 'repeat': return <Repeat {...props} />;
    case 'clock': return <Clock {...props} />;
    case 'alert': return <AlertCircle {...props} />;
    case 'paperclip': return <Paperclip {...props} />;
    default: return <ListChecks {...props} />;
  }
}

function colorFor(severity: string): string {
  if (severity === 'error') return '#ef4444';
  if (severity === 'warn') return '#f59e0b';
  return '#3b82f6';
}

function fmtAgo(iso: string | null): string {
  if (!iso) return 'ніколи';
  const ago = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ago / 60000);
  if (min < 1) return 'щойно';
  if (min < 60) return `${min}хв тому`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}г тому`;
  const d = Math.floor(h / 24);
  return `${d}д тому`;
}

function fmtMoney(n: number, cur: string): string {
  return `${n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

export default function ReconcileDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/reconcile');
      const json = await res.json();
      setData(json);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) {
    return <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-secondary)' }}>Завантаження…</div>;
  }

  return (
    <div className="page-container" style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/finance" style={backLink}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ListChecks size={24} /> Reconciliation Inbox
        </h1>
        <button onClick={fetchData} style={{ ...btn, display: 'flex', alignItems: 'center', gap: 4 }} title="Оновити">
          <RefreshCw size={14} /> Оновити
        </button>
      </div>

      <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13, marginBottom: 24 }}>
        Морнінг-чеклист: що треба зробити (tasks), що пішло не так (exceptions), і поточний стан фінансової мережі.
      </p>

      {/* Status row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Дохід місяця" value={fmtMoney(data.status.month.income_czk, 'CZK')} color="#22c55e" icon={<TrendingUp size={16} />} />
        <KpiCard label="Витрати місяця" value={fmtMoney(data.status.month.expense_czk, 'CZK')} color="#ef4444" icon={<TrendingDown size={16} />} />
        <KpiCard
          label="Чистий потік"
          value={fmtMoney(data.status.month.net_czk, 'CZK')}
          color={data.status.month.net_czk >= 0 ? '#22c55e' : '#ef4444'}
          icon={<Wallet size={16} />}
        />
        <KpiCard
          label="Outstanding receivables"
          value={data.status.outstanding.length === 0 ? '0' : data.status.outstanding.map((o) => fmtMoney(o.total, o.currency)).join(' / ')}
          color="#3b82f6"
          icon={<Clock size={16} />}
        />
      </div>

      {/* Tasks + Exceptions side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Tasks */}
        <Section
          title={`🔴 Tasks (${data.tasks.length})`}
          subtitle="Що треба зробити сьогодні"
          empty="Все зроблено — немає поточних задач 🎉"
          items={data.tasks}
        />

        {/* Exceptions */}
        <Section
          title={`🟡 Exceptions (${data.exceptions.length})`}
          subtitle="Аномалії що варто розібрати"
          empty="Жодних exceptions — все чисто"
          items={data.exceptions}
        />
      </div>

      {/* Sync status footer */}
      <div style={{ marginTop: 24, padding: 16, background: 'var(--bg-secondary)', borderRadius: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>🟢 Останні синхронізації</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <SyncRow label="Банк-приймач (KB)" at={data.status.last_sync.bank_inbox} href="/finance/settings" />
          <SyncRow label="Receipt inbox (чеки)" at={data.status.last_sync.receipt_inbox} href="/finance/receipts" />
          <SyncRow
            label="Teya sync"
            at={data.status.last_sync.teya}
            href="/finance/settings"
            extra={data.status.last_sync.teya_result ? `${data.status.last_sync.teya_result.fetched} txn / +${data.status.last_sync.teya_result.created} new` : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, items, empty }: {
  title: string; subtitle: string; empty: string; items: DashboardItem[];
}) {
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>{subtitle}</div>
      {items.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, border: '1px dashed var(--border-primary)', borderRadius: 8 }}>
          {empty}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it) => (
            <div key={it.id} style={{ padding: 12, background: 'var(--bg-primary)', borderRadius: 8, borderLeft: `3px solid ${colorFor(it.severity)}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ color: colorFor(it.severity) }}>{iconFor(it.icon)}</span>
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{it.title}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>{it.description}</div>
              <Link href={it.action_href} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 12, fontWeight: 600, color: colorFor(it.severity),
                textDecoration: 'none',
              }}>
                {it.action_label} <ExternalLink size={11} />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, color, icon }: {
  label: string; value: string; color: string; icon: React.ReactNode;
}) {
  return (
    <div style={{ padding: 14, background: 'var(--bg-secondary)', borderRadius: 10, borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>
        <span style={{ color }}>{icon}</span> {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function SyncRow({ label, at, href, extra }: { label: string; at: string | null; href?: string; extra?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontWeight: 500 }}>{label}</div>
      <div>{fmtAgo(at)}{extra && <span style={{ marginLeft: 8, opacity: 0.7 }}>· {extra}</span>}</div>
      {href && <Link href={href} style={{ fontSize: 11, color: '#3b82f6', textDecoration: 'none' }}>Налаштування →</Link>}
    </div>
  );
}

const backLink: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: 8,
  background: 'var(--bg-secondary)', borderRadius: 8, color: 'var(--text-primary)', textDecoration: 'none',
};
const btn: React.CSSProperties = {
  padding: '7px 12px', fontSize: 13, fontWeight: 500,
  border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)',
  color: 'var(--text-primary)', borderRadius: 6, cursor: 'pointer',
};
