'use client';

/**
 * Платник броні: фізособа (гість) або компанія з довідника (Блок 4 §2.3,
 * 0093). Джерело форми — Hoteliera, картка броні: «Individual person /
 * Legal entity» з вибором компанії і кнопкою «Add company».
 *
 * Вибір іде одним PATCH `company_id`; сервер сам переписує знімок
 * `invoice_company_*` з довідника (або чистить його при поверненні до
 * гостя) — документ читає знімок. Компанію можна завести тут же, не
 * виходячи з картки: назва й ID, решта — на екрані «Компанії».
 */
import React, { useEffect, useState } from 'react';
import { useT } from '@core/i18n/client';
import { Building2, Plus, User } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CompanyOption { id: string; name: string; business_id: string | null }

interface Props {
  booking: any;
  compact?: boolean;
  showToast: (m: string) => void;
  /** Що записано: id компанії або null, і знімок назви для заголовка картки. */
  onChanged: (patch: { company_id: string | null; invoice_company_name: string | null }) => void;
}

export default function PayerPicker({ booking: b, compact, showToast, onChanged }: Props) {
  const tUi = useT();
  const [companies, setCompanies] = useState<CompanyOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', business_id: '' });

  useEffect(() => {
    let alive = true;
    fetch('/api/companies')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d) => { if (alive) setCompanies(d.rows ?? []); })
      .catch(() => { if (alive) setCompanies([]); });
    return () => { alive = false; };
  }, []);

  const current: string = b.company_id ? String(b.company_id) : '';

  const choose = async (companyId: string | null) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/bookings/${b.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      });
      if (!res.ok) {
        showToast(`❌ ${res.status === 404 ? tUi('Компанію не знайдено') : res.status === 409 ? tUi('Компанія в архіві') : tUi('Не вдалося змінити платника')}`);
        return;
      }
      const name = companyId ? (companies ?? []).find((c) => c.id === companyId)?.name ?? null : null;
      onChanged({ company_id: companyId, invoice_company_name: name });
      showToast(companyId ? `🏢 ${tUi('Платник — компанія')}` : `👤 ${tUi('Платник — гість')}`);
    } finally { setBusy(false); }
  };

  const addCompany = async () => {
    const name = draft.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch('/api/companies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, business_id: draft.business_id.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(`❌ ${data?.error === 'duplicate_business_id' ? tUi('Компанія з таким ID уже є') : tUi('Не вдалося створити компанію')}`);
        return;
      }
      const created = { id: String(data.id), name, business_id: draft.business_id.trim() || null };
      setCompanies((list) => [...(list ?? []), created].sort((x, y) => x.name.localeCompare(y.name)));
      setAdding(false);
      setDraft({ name: '', business_id: '' });
      await choose(created.id);
    } finally { setBusy(false); }
  };

  const font = compact ? 12 : 13;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 700 }}>{tUi('Платник')}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: font, color: 'var(--text-secondary)' }}>
          {current ? <Building2 size={14} /> : <User size={14} />}
        </span>
        <select className="form-input" value={current} disabled={busy || companies === null} style={{ flex: 1, minWidth: 160, fontSize: font }}
          onChange={(e) => choose(e.target.value || null)}>
          <option value="">{tUi('Гість (фізособа)')}</option>
          {(companies ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.business_id ? ` · ${c.business_id}` : ''}</option>
          ))}
        </select>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setAdding((v) => !v)} title={tUi('Додати компанію')}>
          <Plus size={13} /> {!compact && tUi('Компанія')}
        </button>
      </div>
      {adding && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 6, alignItems: 'center' }}>
          <input className="form-input" placeholder={tUi('Назва компанії *')} value={draft.name} style={{ fontSize: font }}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') addCompany(); }} />
          <input className="form-input" placeholder={tUi('ID (IČO)')} value={draft.business_id} style={{ fontSize: font }}
            onChange={(e) => setDraft({ ...draft, business_id: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') addCompany(); }} />
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || !draft.name.trim()} onClick={addCompany}>{tUi('Створити')}</button>
        </div>
      )}
      {current && b.invoice_company_name && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {tUi('Документ буде на')}: <b>{b.invoice_company_name}</b>{b.invoice_company_ico ? ` · ${b.invoice_company_ico}` : ''}
        </div>
      )}
    </div>
  );
}
