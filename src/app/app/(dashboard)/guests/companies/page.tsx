'use client';

/**
 * Компанії-платники (Блок 4 §2.3, 0093). Джерело форми — Hoteliera
 * «Companies»: пошук за назвою / ID, фільтри «є контакти · є банк · є
 * гості · без архівних», сортування за назвою або датою, картки з ID,
 * реєстром, контактами, країною, адресою і лічильником гостей, кнопка
 * «Додати компанію». Довідник — на організацію, а не на обʼєкт: одна фірма
 * платить за броні в усіх готелях власника, тож області обʼєкта тут немає.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '@core/i18n/client';
import { EmptyState, LoadingState, ErrorState } from '@/components/ui/State';
import {
  Plus, Search, Building2, Landmark, Phone, Mail, MapPin, Flag, Users, Archive, ArchiveRestore, Trash2, X, Save, Loader2, Copy, FileText,
} from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CompanyRow {
  id: string;
  name: string;
  business_id: string | null;
  vat_id: string | null;
  registry_no: string | null;
  address_street: string | null;
  address_city: string | null;
  address_zip: string | null;
  address_country: string | null;
  bank_name: string | null;
  iban: string | null;
  bic: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  reservations: number;
  guests: number;
  last_check_in: string | null;
}

type Form = Omit<CompanyRow, 'id' | 'archived_at' | 'created_at' | 'reservations' | 'guests' | 'last_check_in'>;

const EMPTY: Form = {
  name: '', business_id: '', vat_id: '', registry_no: '',
  address_street: '', address_city: '', address_zip: '', address_country: '',
  bank_name: '', iban: '', bic: '', email: '', phone: '', notes: '',
};

const FORM_KEYS = Object.keys(EMPTY) as (keyof Form)[];

export default function CompaniesPage() {
  const t = useT();
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ hasContact: false, hasBank: false, hasGuests: false, includeArchived: false });
  const [sort, setSort] = useState<'name' | 'created_at'>('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ sort, dir });
      if (search.trim()) qs.set('search', search.trim());
      if (filters.hasContact) qs.set('has_contact', '1');
      if (filters.hasBank) qs.set('has_bank', '1');
      if (filters.hasGuests) qs.set('has_guests', '1');
      if (filters.includeArchived) qs.set('include_archived', '1');
      const res = await fetch(`/api/companies?${qs}`);
      if (!res.ok) { setFailed(true); return; }
      setRows((await res.json()).rows ?? []);
      setFailed(false);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [search, filters, sort, dir]);

  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);

  const openNew = () => { setError(''); setEditing({ id: null, form: { ...EMPTY } }); };
  const openEdit = (c: CompanyRow) => {
    const form = { ...EMPTY };
    for (const k of FORM_KEYS) form[k] = (c[k] ?? '') as string;
    setError('');
    setEditing({ id: c.id, form });
  };

  const reasonText = (code: string) => ({
    name_required: t('Назва обовʼязкова'),
    country_format: t('Країна — дві літери (CZ, DE, …)'),
    duplicate_business_id: t('Компанія з таким ID уже є'),
    company_in_use: t('На компанію є броні — її можна лише архівувати'),
  } as Record<string, string>)[code] || t('Не вдалося зберегти');

  const save = async () => {
    if (!editing) return;
    setSaving(true); setError('');
    try {
      const res = await fetch(editing.id ? `/api/companies/${editing.id}` : '/api/companies', {
        method: editing.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing.form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(reasonText(String(data?.error || ''))); return; }
      setEditing(null);
      say(`✅ ${t('Збережено')}`);
      load();
    } catch { setError(t('Не вдалося зберегти')); }
    finally { setSaving(false); }
  };

  const archive = async (c: CompanyRow, archived: boolean) => {
    const res = await fetch(`/api/companies/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }),
    });
    if (!res.ok) { say(`❌ ${t('Не вдалося зберегти')}`); return; }
    say(archived ? `📦 ${t('В архіві')}` : `✅ ${t('Повернуто з архіву')}`);
    load();
  };

  const remove = async (c: CompanyRow) => {
    if (!confirm(`${t('Видалити компанію')} «${c.name}»?`)) return;
    const res = await fetch(`/api/companies/${c.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { say(`❌ ${reasonText(String(data?.error || ''))}`); return; }
    say(`🗑 ${t('Видалено')}`);
    load();
  };

  const copy = (text: string) => { navigator.clipboard?.writeText(text).then(() => say(`📋 ${t('Скопійовано')}`)).catch(() => {}); };

  const list = rows ?? [];
  const activeFilters = useMemo(() => Object.values(filters).filter(Boolean).length, [filters]);

  const chip = (key: keyof typeof filters, text: string) => (
    <button key={key} type="button" className={`filter-chip ${filters[key] ? 'active' : ''}`}
      onClick={() => setFilters((f) => ({ ...f, [key]: !f[key] }))}>{text}</button>
  );

  const field = (k: keyof Form, label: string, opts: { span?: 2; placeholder?: string; textarea?: boolean } = {}) => (
    <div key={k} style={{ gridColumn: opts.span === 2 ? 'span 2' : undefined }}>
      <label className="form-label">{label}</label>
      {opts.textarea ? (
        <textarea className="form-input" rows={3} value={editing?.form[k] ?? ''} placeholder={opts.placeholder}
          onChange={(e) => setEditing((s) => s && ({ ...s, form: { ...s.form, [k]: e.target.value } }))} />
      ) : (
        <input className="form-input" value={editing?.form[k] ?? ''} placeholder={opts.placeholder}
          onChange={(e) => setEditing((s) => s && ({ ...s, form: { ...s.form, [k]: e.target.value } }))} />
      )}
    </div>
  );

  return (
    <>
      <div className="app-content">
        {toast && (
          <div style={{ position: 'fixed', top: 80, right: 24, zIndex: 1000, background: 'var(--bg-tooltip)', color: 'var(--text-inverse)', padding: '10px 16px', borderRadius: 'var(--radius-md)', fontSize: 13 }}>{toast}</div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <div className="search-box" style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input className="form-input" style={{ paddingLeft: 30 }} placeholder={t('Назва, ID або ДІЧ')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="form-input" value={sort} onChange={(e) => setSort(e.target.value as any)} style={{ width: 'auto' }}>
            <option value="name">{t('За назвою')}</option>
            <option value="created_at">{t('За датою створення')}</option>
          </select>
          <select className="form-input" value={dir} onChange={(e) => setDir(e.target.value as any)} style={{ width: 'auto' }}>
            <option value="asc">{t('За зростанням')}</option>
            <option value="desc">{t('За спаданням')}</option>
          </select>
          <button type="button" className="btn btn-primary" onClick={openNew}><Plus size={14} /> {t('Додати компанію')}</button>
        </div>

        <div className="filter-chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
          {chip('hasContact', t('Є контакти'))}
          {chip('hasBank', t('Є банк'))}
          {chip('hasGuests', t('Є гості'))}
          {chip('includeArchived', t('Показати архівні'))}
          {activeFilters > 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFilters({ hasContact: false, hasBank: false, hasGuests: false, includeArchived: false })}>
              <X size={12} /> {t('Скинути фільтри')}
            </button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)' }}>{list.length} {t('компаній')}</span>
        </div>

        {loading ? <LoadingState /> : failed ? <ErrorState retry={() => { setLoading(true); load(); }} /> : list.length === 0 ? (
          <EmptyState icon={<Building2 size={28} />} title={t('Компаній ще немає')}
            hint={t('Компанія — платник-юрособа: її реквізити лягають на документ. Додайте першу або оберіть на картці броні.')}
            action={{ label: t('Додати компанію'), onClick: openNew }} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {list.map((c) => (
              <div key={c.id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6, opacity: c.archived_at ? 0.6 : 1, cursor: 'pointer' }}
                onClick={() => openEdit(c)}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                  {c.archived_at && <span className="badge badge-info" style={{ fontSize: 10 }}>{t('Архів')}</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {c.business_id && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <FileText size={13} /> <span style={{ fontFamily: 'var(--font-mono)' }}>{c.business_id}</span>
                      {c.vat_id && <span style={{ color: 'var(--text-tertiary)' }}>· {c.vat_id}</span>}
                      <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 4px', marginLeft: 'auto' }} title={t('Скопіювати ID')}
                        onClick={(e) => { e.stopPropagation(); copy(c.business_id!); }}><Copy size={12} /></button>
                    </div>
                  )}
                  {c.registry_no && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Landmark size={13} /> {c.registry_no}</div>}
                  {c.phone && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Phone size={13} /> {c.phone}</div>}
                  {c.email && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Mail size={13} /> {c.email}</div>}
                  {c.address_country && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Flag size={13} /> {c.address_country}</div>}
                  {(c.address_city || c.address_zip || c.address_street) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <MapPin size={13} /> {[c.address_street, [c.address_zip, c.address_city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
                    </div>
                  )}
                  {(c.bank_name || c.iban) && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Landmark size={13} /> {c.bank_name || ''} {c.iban ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{c.iban}</span> : null}</div>}
                </div>
                <div style={{ borderTop: '1px solid var(--border-primary)', marginTop: 4, paddingTop: 8, display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Users size={12} /> {c.guests} {t('гостей')} · {c.reservations} {t('броней')}</span>
                  <span style={{ marginLeft: 'auto' }}>{c.last_check_in || String(c.created_at).slice(0, 10)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div className="modal-overlay" onClick={() => setEditing(null)}>
            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3 className="modal-title">{editing.id ? t('Компанія') : t('Нова компанія')}</h3>
                <button className="modal-close" onClick={() => setEditing(null)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {field('name', t('Назва *'), { span: 2 })}
                  {field('business_id', t('ID компанії (IČO)'))}
                  {field('vat_id', t('ДІЧ / VAT ID'))}
                  {field('registry_no', t('Реєстраційний номер'), { span: 2, placeholder: t('Суд, розділ, вкладка') })}
                  {field('address_street', t('Вулиця'), { span: 2 })}
                  {field('address_zip', t('Індекс'))}
                  {field('address_city', t('Місто'))}
                  {field('address_country', t('Країна'), { placeholder: 'CZ' })}
                  {field('email', 'Email')}
                  {field('phone', t('Телефон'))}
                  {field('bank_name', t('Банк'))}
                  {field('iban', 'IBAN')}
                  {field('bic', 'BIC / SWIFT')}
                  {field('notes', t('Примітки'), { span: 2, textarea: true })}
                </div>
                {error && <div style={{ marginTop: 10, color: 'var(--accent-danger)', fontSize: 13 }}>❌ {error}</div>}
              </div>
              <div className="modal-footer" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {editing.id && (() => {
                  const current = list.find((c) => c.id === editing.id);
                  if (!current) return null;
                  return (
                    <>
                      {current.archived_at ? (
                        <button type="button" className="btn btn-secondary" onClick={() => { archive(current, false); setEditing(null); }}><ArchiveRestore size={14} /> {t('З архіву')}</button>
                      ) : (
                        <button type="button" className="btn btn-secondary" onClick={() => { archive(current, true); setEditing(null); }}><Archive size={14} /> {t('В архів')}</button>
                      )}
                      {current.reservations === 0 && (
                        <button type="button" className="btn btn-ghost" style={{ color: 'var(--accent-danger)' }} onClick={() => { remove(current); setEditing(null); }}><Trash2 size={14} /> {t('Видалити')}</button>
                      )}
                    </>
                  );
                })()}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>{t('Скасувати')}</button>
                  <button type="button" className="btn btn-primary" disabled={saving || !editing.form.name.trim()} onClick={save}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {t('Зберегти')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
