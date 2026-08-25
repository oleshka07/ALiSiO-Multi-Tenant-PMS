'use client';

/**
 * Хто написав готелю через форму на сайті.
 *
 * Вкладка «Форми» була в панелі вкладок, компонента за нею не існувало, і
 * клік відкривав порожню панель. Таблиця `site_incoming_leads` при цьому є,
 * лійка в аналітиці рахує її рядки, а міграція перелила в неї дані зі старої
 * таблиці — тобто це не гіпотетичні рядки, а листи, які хтось написав, і їх
 * ніхто не бачив.
 */

import { useT } from '@core/i18n/client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Inbox, Mail, Phone, Archive, MailOpen } from 'lucide-react';

interface Lead {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  status: 'new' | 'read' | 'archived';
  created_at: string;
}

const FILTERS = [
  { id: 'new', label: 'Нові' },
  { id: 'read', label: 'Прочитані' },
  { id: 'archived', label: 'В архіві' },
  { id: 'all', label: 'Всі' },
] as const;

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  new:      { label: 'Нове',       color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  read:     { label: 'Прочитано',  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  archived: { label: 'В архіві',   color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
};

function when(value: string): string {
  // Дата приходить як текст SQLite або як TIMESTAMPTZ Postgres — обидва
  // варіанти читаються, а нерозпізнане показується як є, а не як Invalid Date.
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function FormsTab({ siteId, onCountChange }: { siteId: string; onCountChange?: (n: number) => void }) {
  const t = useT();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({ new: 0, read: 0, archived: 0 });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('new');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const onCountRef = useRef(onCountChange);
  useEffect(() => { onCountRef.current = onCountChange; }, [onCountChange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = filter === 'all' ? '' : `?status=${filter}`;
      const res = await fetch(`/api/booking-sites/${siteId}/leads${qs}`);
      if (!res.ok) {
        // Мовчазний порожній список — це те, чим ця вкладка була досі.
        setError(t('Не вдалося завантажити звернення'));
        setLeads([]);
        return;
      }
      const data = await res.json();
      setLeads(Array.isArray(data.leads) ? data.leads : []);
      setCounts(data.counts || { new: 0, read: 0, archived: 0 });
      onCountRef.current?.(Number(data.counts?.new) || 0);
    } catch {
      setError(t('Не вдалося завантажити звернення'));
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [siteId, filter, t]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: Lead['status']) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/booking-sites/${siteId}/leads`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) { setError(t('Не вдалося змінити статус')); return; }
      await load();
    } catch {
      setError(t('Не вдалося змінити статус'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Loader2 size={22} className="spin" style={{ color: 'var(--text-tertiary)' }} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f.id} className="btn btn-ghost" onClick={() => setFilter(f.id)}
            style={{
              padding: '6px 12px', fontSize: 13,
              fontWeight: filter === f.id ? 600 : 400,
              color: filter === f.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
              border: `1px solid ${filter === f.id ? 'var(--accent-primary)' : 'var(--border-primary)'}`,
              borderRadius: 8,
            }}>
            {t(f.label)}
            {f.id !== 'all' && counts[f.id] > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700 }}>{counts[f.id]}</span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13, background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      {leads.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
          <Inbox size={28} style={{ marginBottom: 12, opacity: 0.6 }} />
          <div style={{ fontSize: 14 }}>{t('Звернень немає')}</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            {t('Тут з’являються повідомлення з контактної форми сайту')}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {leads.map(lead => {
            const cfg = STATUS_CFG[lead.status] || STATUS_CFG.new;
            return (
              <div key={lead.id} style={{
                border: '1px solid var(--border-primary)', borderRadius: 10,
                padding: 16, background: 'var(--surface-primary)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{lead.full_name || t('Без імені')}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
                    color: cfg.color, background: cfg.bg,
                  }}>{t(cfg.label)}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                    {when(lead.created_at)}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, marginBottom: 8 }}>
                  {lead.email && (
                    <a href={`mailto:${lead.email}`} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-primary)' }}>
                      <Mail size={14} /> {lead.email}
                    </a>
                  )}
                  {lead.phone && (
                    <a href={`tel:${lead.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-primary)' }}>
                      <Phone size={14} /> {lead.phone}
                    </a>
                  )}
                </div>

                {lead.message && (
                  <div style={{
                    fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.5,
                    padding: 12, borderRadius: 8, background: 'var(--surface-secondary)',
                  }}>{lead.message}</div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  {lead.status !== 'read' && (
                    <button className="btn btn-ghost" disabled={busyId === lead.id}
                      onClick={() => setStatus(lead.id, 'read')}
                      style={{ padding: '6px 12px', fontSize: 13 }}>
                      <MailOpen size={14} /> {t('Прочитано')}
                    </button>
                  )}
                  {lead.status !== 'archived' && (
                    <button className="btn btn-ghost" disabled={busyId === lead.id}
                      onClick={() => setStatus(lead.id, 'archived')}
                      style={{ padding: '6px 12px', fontSize: 13 }}>
                      <Archive size={14} /> {t('В архів')}
                    </button>
                  )}
                  {lead.status === 'archived' && (
                    <button className="btn btn-ghost" disabled={busyId === lead.id}
                      onClick={() => setStatus(lead.id, 'new')}
                      style={{ padding: '6px 12px', fontSize: 13 }}>
                      <Inbox size={14} /> {t('Повернути')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
