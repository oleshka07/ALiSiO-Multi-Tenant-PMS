'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, Search, Paperclip, Archive, ExternalLink, ArrowLeft, Image as ImageIcon, FileText, FileArchive } from 'lucide-react';

interface PendingReceipt {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  sender_email: string | null;
  subject: string | null;
  received_at: string | null;
  detected_amount: number | null;
  detected_currency: string | null;
  auto_matched_operation_id: string | null;
  status: string;
  matched_op_amount?: number;
  matched_op_currency?: string;
  matched_op_paid_at?: string;
  matched_op_comment?: string;
  matched_op_counterparty?: string;
}

interface OperationOption {
  id: string;
  paid_at: string;
  amount: number;
  currency: string;
  comment: string | null;
  counterparty_name: string | null;
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtMoney(n: number | null | undefined, currency: string | null | undefined): string {
  if (n == null || !currency) return '—';
  return `${n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function MimeIcon({ mime }: { mime: string | null }) {
  if (mime?.startsWith('image/')) return <ImageIcon size={14} color="#3b82f6" />;
  if (mime === 'application/pdf') return <FileText size={14} color="#dc2626" />;
  if (mime?.includes('zip')) return <FileArchive size={14} color="#a16207" />;
  return <FileText size={14} color="#6b7280" />;
}

export default function ReceiptsPage() {
  const [items, setItems] = useState<PendingReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('pending,matched');
  const [linkingFor, setLinkingFor] = useState<string | null>(null);
  const [opSearch, setOpSearch] = useState('');
  const [opOptions, setOpOptions] = useState<OperationOption[]>([]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      // 'pending,matched' is a synthetic filter — server only supports single status
      // so we fetch each separately when both, then merge
      if (statusFilter === 'pending,matched') {
        const [pendRes, matchRes] = await Promise.all([
          fetch('/api/finance/receipts?status=pending&limit=500'),
          fetch('/api/finance/receipts?status=matched&limit=500'),
        ]);
        const pendJ = await pendRes.json();
        const matchJ = await matchRes.json();
        setItems([...(matchJ.items || []), ...(pendJ.items || [])]);
      } else {
        const params = new URLSearchParams();
        if (statusFilter) params.set('status', statusFilter);
        const res = await fetch(`/api/finance/receipts?${params}`);
        const json = await res.json();
        setItems(json.items || []);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const fetchOps = useCallback(async () => {
    if (!linkingFor) return;
    try {
      const params = new URLSearchParams({ pageSize: '50' });
      if (opSearch.trim()) params.set('search', opSearch.trim());
      const res = await fetch(`/api/finance/operations?${params}`);
      const json = await res.json();
      setOpOptions(json.items || []);
    } catch (e) { console.error(e); }
  }, [linkingFor, opSearch]);

  useEffect(() => { fetchOps(); }, [fetchOps]);

  async function handleAttach(pendingId: string, operationId: string) {
    try {
      const res = await fetch(`/api/finance/receipts/${pendingId}/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation_id: operationId }),
      });
      const j = await res.json();
      if (!res.ok) { alert(`Помилка: ${j.error}`); return; }
      setLinkingFor(null);
      fetchItems();
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
  }

  async function handleArchive(pendingId: string) {
    if (!confirm('Архівувати цей чек?')) return;
    try {
      const res = await fetch(`/api/finance/receipts/${pendingId}/archive`, { method: 'POST' });
      if (!res.ok) { const j = await res.json(); alert(`Помилка: ${j.error}`); return; }
      fetchItems();
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
  }

  return (
    <div className="page-container" style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/finance" style={backLink}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Mail size={24} /> Чеки з пошти
        </h1>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={input}>
          <option value="pending,matched">Pending + Matched</option>
          <option value="pending">Pending</option>
          <option value="matched">Auto-matched</option>
          <option value="attached">Прикріплені</option>
          <option value="archived">Архів</option>
        </select>
      </div>

      <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
        Налаштуй inbox у <Link href="/finance/settings" style={{ color: '#3b82f6' }}>Налаштуваннях → Receipt inbox</Link>.
        Пересилай чеки/інвойси на цю поштову скриньку — система автоматично витягне вкладення і спробує матчити по сумі.
      </p>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Завантаження…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border-primary)', borderRadius: 10, marginTop: 16 }}>
          Немає чеків у обраному статусі.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12, marginTop: 16 }}>
          {items.map((r) => (
            <div key={r.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <MimeIcon mime={r.mime_type} />
                <a href={`/api/finance/receipts/${r.id}/file`} target="_blank" rel="noopener noreferrer"
                   style={{ flex: 1, color: 'var(--text-primary)', textDecoration: 'none', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {r.file_name} <ExternalLink size={10} style={{ opacity: 0.5 }} />
                </a>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{fmtSize(r.size_bytes)}</span>
              </div>

              {r.subject && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  📧 {r.subject}
                </div>
              )}
              {r.sender_email && (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, fontFamily: 'monospace' }}>
                  {r.sender_email}
                </div>
              )}

              {r.detected_amount && (
                <div style={{ fontSize: 12, marginBottom: 8 }}>
                  💰 Сума з листа: <b>{fmtMoney(r.detected_amount, r.detected_currency)}</b>
                </div>
              )}

              {r.auto_matched_operation_id && (
                <div style={{ padding: 8, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, color: '#16a34a', marginBottom: 4 }}>🎯 Автоматчинг: {fmtMoney(r.matched_op_amount, r.matched_op_currency)}</div>
                  <div style={{ color: 'var(--text-secondary)' }}>{r.matched_op_paid_at} · {r.matched_op_counterparty || r.matched_op_comment || '—'}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button onClick={() => handleAttach(r.id, r.auto_matched_operation_id!)} style={{ ...btnSmall, background: '#16a34a', color: '#fff', border: 'none' }}>
                      ✓ Підтвердити attach
                    </button>
                    <button onClick={() => setLinkingFor(r.id)} style={btnSmall}>
                      Інша операція
                    </button>
                  </div>
                </div>
              )}

              {r.status === 'attached' && (
                <div style={{ padding: 6, background: 'rgba(99,102,241,0.08)', borderRadius: 6, fontSize: 12, color: '#6366f1', textAlign: 'center' }}>
                  ✓ Прикріплено до операції
                </div>
              )}

              {(r.status === 'pending' || r.status === 'matched') && !r.auto_matched_operation_id && (
                <button onClick={() => setLinkingFor(r.id)} style={{ ...btnSmall, width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Paperclip size={12} /> Привʼязати до операції
                </button>
              )}

              {r.status !== 'archived' && (
                <button onClick={() => handleArchive(r.id)} style={{ ...btnSmall, marginTop: 6, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, opacity: 0.7 }}>
                  <Archive size={12} /> Архівувати
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Link-to-operation modal */}
      {linkingFor && (
        <div style={overlayStyle} onClick={() => setLinkingFor(null)}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: 12, padding: 20, minWidth: 500, maxWidth: 700, maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, marginBottom: 12, fontSize: 16 }}>Привʼязати до операції</h3>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-secondary)' }} />
              <input type="text" placeholder="Пошук по коментарю..." value={opSearch} onChange={(e) => setOpSearch(e.target.value)} style={{ ...input, paddingLeft: 30, width: '100%' }} />
            </div>
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {opOptions.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', padding: 20, textAlign: 'center' }}>Нічого не знайдено</div>
              ) : opOptions.map((op) => (
                <div key={op.id}
                     onClick={() => handleAttach(linkingFor, op.id)}
                     style={{ padding: 10, borderBottom: '1px solid var(--border-primary)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{fmtMoney(op.amount, op.currency)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{op.paid_at?.substring(0, 10)} · {op.counterparty_name || op.comment || '—'}</div>
                  </div>
                  <button style={{ ...btnSmall, background: '#3b82f6', color: '#fff', border: 'none' }}>Привʼязати</button>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setLinkingFor(null)} style={{ ...btnSmall, padding: '8px 16px' }}>Закрити</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const backLink: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: 8,
  background: 'var(--bg-secondary)', borderRadius: 8, color: 'var(--text-primary)', textDecoration: 'none',
};
const input: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--border-primary)', borderRadius: 6,
  fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)',
};
const card: React.CSSProperties = {
  padding: 14, border: '1px solid var(--border-primary)', borderRadius: 10,
  background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column',
};
const btnSmall: React.CSSProperties = {
  padding: '6px 10px', fontSize: 11, fontWeight: 500,
  border: '1px solid var(--border-primary)', background: 'var(--bg-primary)',
  color: 'var(--text-primary)', borderRadius: 6, cursor: 'pointer',
};
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
