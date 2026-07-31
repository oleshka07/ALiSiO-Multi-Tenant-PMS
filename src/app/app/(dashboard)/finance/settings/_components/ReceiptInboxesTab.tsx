'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail, Plus, Trash2, RefreshCw, Eye, EyeOff } from 'lucide-react';

interface ReceiptInbox {
  id: string;
  name: string;
  imap_host: string;
  imap_port: number;
  imap_user: string;
  imap_folder: string;
  use_tls: number;
  sender_filter: string | null;
  subject_filter: string | null;
  auto_match_threshold_pct: number;
  last_synced_at: string | null;
  last_email_at: string | null;
  last_error: string | null;
  emails_processed: number;
  receipts_imported: number;
  is_active: number;
}

export default function ReceiptInboxesTab() {
  const [items, setItems] = useState<ReceiptInbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<ReceiptInbox> & { imap_password?: string } | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/receipt-inboxes');
      const json = await res.json();
      setItems(json.items || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  async function save() {
    if (!editing?.name || !editing?.imap_host || !editing?.imap_user) {
      alert('Заповни name, imap_host, imap_user');
      return;
    }
    if (!editing.id && !editing.imap_password) {
      alert('Введи пароль для нового inbox');
      return;
    }
    try {
      const method = editing.id ? 'PUT' : 'POST';
      const url = editing.id ? `/api/finance/receipt-inboxes/${editing.id}` : '/api/finance/receipt-inboxes';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      const j = await res.json();
      if (!res.ok) { alert(`Помилка: ${j.error}`); return; }
      setEditing(null);
      fetchItems();
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Видалити «${name}»?`)) return;
    await fetch(`/api/finance/receipt-inboxes/${id}`, { method: 'DELETE' });
    fetchItems();
  }

  async function runNow(id: string) {
    setRunning(id);
    try {
      const res = await fetch(`/api/finance/receipt-inboxes/${id}/run-now`, { method: 'POST' });
      const j = await res.json();
      if (!res.ok) alert(`Помилка: ${j.error}`);
      else alert(`✓ Знайдено email: ${j.newEmails}, attachments: ${j.attachmentsImported}, auto-matched: ${j.autoMatched}`);
      fetchItems();
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
    setRunning(null);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Mail size={20} color="#3b82f6" />
        <h2 style={{ margin: 0, fontSize: 18 }}>Receipt inbox — пошта для чеків</h2>
        <button onClick={() => setEditing({ imap_port: 993, use_tls: 1, imap_folder: 'INBOX', auto_match_threshold_pct: 1.0 })}
                style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          <Plus size={14} /> Додати inbox
        </button>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
        Пересилай чеки/інвойси на цю поштову адресу — система щ 15 хв полить її через IMAP, витягне вкладення (PDF/img/Excel),
        спробує матчити по сумі з листа до існуючої витрати, і покаже їх у <a href="/app/finance/receipts" style={{ color: '#3b82f6' }}>«Чеки з пошти»</a>.
      </p>

      {loading ? <div>Завантаження…</div> : items.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border-primary)', borderRadius: 8 }}>
          Inbox не налаштовано. Додай перший.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((i) => (
            <div key={i.id} style={{ padding: 12, border: '1px solid var(--border-primary)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{i.name} {i.is_active ? '' : <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>(вимкнено)</span>}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {i.imap_user}@{i.imap_host}:{i.imap_port} · {i.imap_folder}
                  {i.sender_filter && ` · sender: ${i.sender_filter}`}
                  {i.subject_filter && ` · subject: ${i.subject_filter}`}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Останній sync: {i.last_synced_at || '—'} · опрацьовано: {i.emails_processed} email / {i.receipts_imported} attachment(s)
                  {i.last_error && <span style={{ color: '#ef4444' }}> · err: {i.last_error.slice(0, 60)}</span>}
                </div>
              </div>
              <button onClick={() => runNow(i.id)} disabled={running === i.id} style={btn} title="Зчитати зараз">
                <RefreshCw size={14} style={running === i.id ? { animation: 'spin 1s linear infinite' } : undefined} />
              </button>
              <button onClick={() => setEditing(i)} style={btn}>Редагувати</button>
              <button onClick={() => remove(i.id, i.name)} style={{ ...btn, color: '#dc2626' }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div style={overlayStyle} onClick={() => setEditing(null)}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: 12, padding: 24, minWidth: 480, maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, marginBottom: 16 }}>{editing.id ? 'Редагувати inbox' : 'Новий inbox'}</h3>
            <Field label="Назва"><input style={input} value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="IMAP host"><input style={input} value={editing.imap_host || ''} onChange={(e) => setEditing({ ...editing, imap_host: e.target.value })} placeholder="imap.gmail.com" /></Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 2 }}><Field label="User (email)"><input style={input} value={editing.imap_user || ''} onChange={(e) => setEditing({ ...editing, imap_user: e.target.value })} placeholder="receipts@..." /></Field></div>
              <div style={{ flex: 1 }}><Field label="Port"><input style={input} type="number" value={editing.imap_port || 993} onChange={(e) => setEditing({ ...editing, imap_port: parseInt(e.target.value) })} /></Field></div>
            </div>
            <Field label={editing.id ? 'Пароль (заповни лише щоб змінити)' : 'App password'}>
              <div style={{ display: 'flex', gap: 4 }}>
                <input style={{ ...input, flex: 1 }} type={showPwd ? 'text' : 'password'} value={editing.imap_password || ''} onChange={(e) => setEditing({ ...editing, imap_password: e.target.value })} placeholder={editing.id ? '(без змін)' : 'Gmail App Password'} />
                <button type="button" onClick={() => setShowPwd(!showPwd)} style={btn}>{showPwd ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              </div>
            </Field>
            <Field label="Folder (default INBOX)"><input style={input} value={editing.imap_folder || 'INBOX'} onChange={(e) => setEditing({ ...editing, imap_folder: e.target.value })} /></Field>
            <Field label="Sender filter (опц., e.g. invoices@vendor.com)"><input style={input} value={editing.sender_filter || ''} onChange={(e) => setEditing({ ...editing, sender_filter: e.target.value || null })} /></Field>
            <Field label="Subject filter (опц.)"><input style={input} value={editing.subject_filter || ''} onChange={(e) => setEditing({ ...editing, subject_filter: e.target.value || null })} /></Field>
            <Field label="Auto-match tolerance % (default 1%)"><input style={input} type="number" step="0.1" value={editing.auto_match_threshold_pct || 1.0} onChange={(e) => setEditing({ ...editing, auto_match_threshold_pct: parseFloat(e.target.value) })} /></Field>
            {editing.id && (
              <Field label="Активний"><input type="checkbox" checked={!!editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked ? 1 : 0 })} /></Field>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setEditing(null)} style={btn}>Відміна</button>
              <button onClick={save} style={{ ...btn, background: '#3b82f6', color: '#fff', border: 'none' }}>Зберегти</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const input: React.CSSProperties = { padding: '7px 10px', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)', width: '100%' };
const btn: React.CSSProperties = { padding: '6px 12px', fontSize: 13, fontWeight: 500, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 };
const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
