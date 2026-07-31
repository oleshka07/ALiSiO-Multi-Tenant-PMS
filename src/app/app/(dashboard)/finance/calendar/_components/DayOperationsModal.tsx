'use client';

import { X, Clock, AlertTriangle } from 'lucide-react';

interface Props {
  day: {
    date: string;
    operations: any[];
    recurring_previews: any[];
    forecast_balance: number;
    cash_gap: boolean;
  };
  onClose: () => void;
  onOperationSaved: () => void;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
  return `${d} ${months[m - 1]} ${y}`;
}

function formatMoney(amt: number, currency: string): string {
  return `${amt.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function DayOperationsModal({ day, onClose }: Props) {
  const income = day.operations.filter((o) => o.op_type === 'income');
  const expense = day.operations.filter((o) => o.op_type === 'expense');
  const transfer = day.operations.filter((o) => o.op_type === 'transfer');
  const recurring = day.recurring_previews;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 10 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{formatDate(day.date)}</h3>
          {day.cash_gap && (
            <span style={{ padding: '3px 8px', background: 'rgba(220,38,38,0.1)', color: '#dc2626', borderRadius: 4, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={12} /> Cash-gap
            </span>
          )}
          <button type="button" onClick={onClose} style={closeBtn}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div>
            <div style={lblStyle}>Прогноз залишку</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: day.forecast_balance < 0 ? '#ef4444' : 'var(--text-primary)' }}>
              {Math.round(day.forecast_balance).toLocaleString('cs-CZ')} CZK
            </div>
          </div>
        </div>

        {income.length > 0 && (
          <Section title="Надходження" color="#22c55e">
            {income.map((o) => <OpRow key={o.id} op={o} />)}
          </Section>
        )}
        {expense.length > 0 && (
          <Section title="Витрати" color="#ef4444">
            {expense.map((o) => <OpRow key={o.id} op={o} />)}
          </Section>
        )}
        {transfer.length > 0 && (
          <Section title="Перекази" color="#6366f1">
            {transfer.map((o) => <OpRow key={o.id} op={o} />)}
          </Section>
        )}
        {recurring.length > 0 && (
          <Section title="Заплановані за регулярками" color="#94a3b8">
            {recurring.map((r, i) => (
              <div key={`${r.template_id}-${i}`} style={rowStyle}>
                <Clock size={12} style={{ color: 'var(--text-secondary)', marginRight: 6 }} />
                <span style={{ flex: 1, fontSize: 13 }}>{r.template_name}</span>
                <span style={{ fontWeight: 600, color: r.op_type === 'income' ? '#22c55e' : '#ef4444' }}>
                  {r.op_type === 'income' ? '+' : '−'} {formatMoney(r.amount, r.currency)}
                </span>
              </div>
            ))}
          </Section>
        )}

        {day.operations.length === 0 && recurring.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
            Операцій на цей день немає.
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color, textTransform: 'uppercase', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </div>
  );
}

function OpRow({ op }: { op: any }) {
  const isIncome = op.op_type === 'income';
  const isExpense = op.op_type === 'expense';
  const isTransfer = op.op_type === 'transfer';
  const sign = isTransfer ? '⇄' : isIncome ? '+' : '−';
  const color = isTransfer ? 'var(--text-secondary)' : isIncome ? '#22c55e' : '#ef4444';
  return (
    <div style={rowStyle}>
      <span style={{ flex: 1, fontSize: 13 }}>
        {op.category_icon ? <span style={{ marginRight: 4 }}>{op.category_icon}</span> : null}
        {op.category_name || op.comment?.substring(0, 50) || (isTransfer ? `${op.account_from_name} → ${op.account_to_name}` : '—')}
        {op.status === 'pending' && <span style={{ fontSize: 10, padding: '1px 5px', marginLeft: 6, background: '#fef3c7', color: '#d97706', borderRadius: 3 }}>pending</span>}
      </span>
      <span style={{ fontWeight: 600, color }}>{sign} {Math.abs(op.amount).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {op.currency}</span>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalStyle: React.CSSProperties = {
  background: 'var(--bg-primary)', borderRadius: 12, padding: 24,
  width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto',
  border: '1px solid var(--border-primary)',
};
const closeBtn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 };
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '6px 10px',
  background: 'var(--bg-secondary)', borderRadius: 6,
};
const lblStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' };
