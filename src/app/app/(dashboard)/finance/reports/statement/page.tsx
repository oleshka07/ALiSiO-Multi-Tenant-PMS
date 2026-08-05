'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText, ChevronRight } from 'lucide-react';

interface Account { id: string; name: string; currency: string; balance: number; color: string; type: string; is_active: number }

const TYPE_LABELS: Record<string, string> = {
  cash: 'Готівка', bank: 'Банк', card: 'Картка', investment: 'Інвестиції', other: 'Інше',
};

export default function StatementListPage() {
  const t = useT();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/accounts');
      const json = await res.json();
      setAccounts(Array.isArray(json) ? json : []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  return (
    <div className="page-container" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/app/finance/reports" style={backLink}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={24} /> {t('Виписка за рахунком')}
        </h1>
      </div>

      <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 14 }}>
        {t('Оберіть рахунок, щоб переглянути його виписку з running balance:')}
      </p>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>{t('Завантаження…')}</div>
      ) : accounts.length === 0 ? (
        <div style={emptyStyle}>{t('Немає рахунків')}</div>
      ) : (
        <div style={{ marginTop: 16, border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
          {accounts.map((a) => (
            <Link key={a.id} href={`/app/finance/reports/statement/${a.id}`} style={rowLink}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: a.color, marginRight: 10 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{a.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{TYPE_LABELS[a.type]} · {a.currency}</div>
              </div>
              <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginRight: 12 }}>
                {a.balance.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {a.currency}
              </div>
              <ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const backLink: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: 8,
  background: 'var(--bg-secondary)', borderRadius: 8, color: 'var(--text-primary)', textDecoration: 'none',
};
const rowLink: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '12px 16px',
  borderBottom: '1px solid var(--border-primary)', color: 'var(--text-primary)',
  textDecoration: 'none', background: 'var(--bg-primary)',
};
const emptyStyle: React.CSSProperties = {
  padding: 40, textAlign: 'center', color: 'var(--text-secondary)',
  border: '1px dashed var(--border-primary)', borderRadius: 10, marginTop: 16,
};
