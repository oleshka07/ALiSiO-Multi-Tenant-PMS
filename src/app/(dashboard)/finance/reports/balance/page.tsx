'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Scale } from 'lucide-react';

interface Account {
  id: string;
  name: string;
  type: string;
  currency: string;
  credit_limit: number | null;
  color: string;
  balance: number;
  debt?: number;
  available?: number;
}

interface Data {
  as_of: string;
  assets: Account[];
  liabilities: Account[];
  byCurrency: Record<string, { assets: number; liabilities: number; net: number }>;
}

const TYPE_LABELS: Record<string, string> = {
  cash: 'Готівка', bank: 'Банк', card: 'Картка', investment: 'Інвестиції', other: 'Інше',
};

function formatMoney(n: number, currency: string): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function BalancePage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().substring(0, 10));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/balance?as_of=${asOf}`);
      setData(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [asOf]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/finance/reports" style={backLink}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Scale size={24} /> Баланс
        </h1>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)', marginRight: 8 }}>На дату:</label>
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={input} />
      </div>

      {loading || !data ? (
        <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-secondary)' }}>Завантаження…</div>
      ) : (
        <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Section title="Активи" color="#22c55e" total={Object.values(data.byCurrency).reduce((s, v) => s + v.assets, 0)}>
            {data.assets.length === 0 ? (
              <div style={emptyStyle}>Немає активів</div>
            ) : data.assets.map((a) => (
              <AccountRow key={a.id} account={a} amount={Math.max(0, a.balance)} />
            ))}
          </Section>

          <Section title="Пасиви (кредитки)" color="#ef4444" total={Object.values(data.byCurrency).reduce((s, v) => s + v.liabilities, 0)}>
            {data.liabilities.length === 0 ? (
              <div style={emptyStyle}>Немає кредитних карток з боргом</div>
            ) : data.liabilities.map((a) => (
              <div key={a.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-primary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: a.color, display: 'inline-block' }} />
                  <span style={{ flex: 1 }}>{a.name}</span>
                  <span style={{ fontWeight: 700, color: '#ef4444' }}>{formatMoney(a.debt || 0, a.currency)}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 18, marginTop: 2 }}>
                  Доступно: {formatMoney(a.available || 0, a.currency)} / Ліміт: {formatMoney(a.credit_limit || 0, a.currency)}
                </div>
              </div>
            ))}
          </Section>

          <div style={{ gridColumn: '1 / -1', padding: 16, background: 'var(--bg-secondary)', borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>
              Чисті активи (Активи − Пасиви)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
              {Object.entries(data.byCurrency).map(([cur, v]) => (
                <div key={cur}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{cur}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: v.net < 0 ? '#ef4444' : '#22c55e' }}>
                    {formatMoney(v.net, cur)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, color, total, children }: { title: string; color: string; total: number; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: 12, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, color }}>{title}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function AccountRow({ account, amount }: { account: Account; amount: number }) {
  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: account.color, display: 'inline-block' }} />
      <span style={{ flex: 1 }}>
        {account.name}
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>{TYPE_LABELS[account.type]}</span>
      </span>
      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatMoney(amount, account.currency)}</span>
    </div>
  );
}

const backLink: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: 8,
  background: 'var(--bg-secondary)', borderRadius: 8, color: 'var(--text-primary)', textDecoration: 'none',
};
const input: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--border-primary)', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-primary)', color: 'var(--text-primary)',
};
const emptyStyle: React.CSSProperties = {
  padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13,
};
