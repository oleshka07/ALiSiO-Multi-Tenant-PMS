'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/lib/MobileMenuContext';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  default_currency: string;
  legal_name: string | null;
  registration_no: string | null;
  vat_no: string | null;
  is_vat_payer: number;
  legal_address: string | null;
  bank_name: string | null;
  bank_account: string | null;
  iban: string | null;
  swift: string | null;
  invoice_email: string | null;
  website: string | null;
}

interface Property {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
}

// Europe-focused: the list stays short enough to scan, and Intl validates
// whatever is submitted server-side anyway.
const TIMEZONES = [
  'Europe/Prague', 'Europe/Kyiv', 'Europe/Warsaw', 'Europe/Berlin', 'Europe/Vienna',
  'Europe/Bratislava', 'Europe/Budapest', 'Europe/Rome', 'Europe/Madrid', 'Europe/Paris',
  'Europe/Amsterdam', 'Europe/London', 'Europe/Lisbon', 'Europe/Athens', 'Europe/Bucharest',
];

export default function GeneralSettingsPage() {
  const onMenuClick = useMobileMenu();
  const [org, setOrg] = useState<Organization | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3200); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/general');
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${data.error}`); return; }
      setOrg(data.organization);
      setProperty(data.property);
      setCurrencies(data.currencies ?? []);
    } catch (e: any) {
      showToast(`❌ ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!org) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/general', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization: org, property }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${data.error}`); return; }
      setOrg(data.organization);
      setProperty(data.property);
      showToast('✅ Збережено');
    } catch (e: any) {
      showToast(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const setOrgField = (k: keyof Organization, v: string | number) => setOrg((p) => (p ? { ...p, [k]: v } : p));
  const setPropField = (k: keyof Property, v: string) => setProperty((p) => (p ? { ...p, [k]: v } : p));

  return (
    <>
      <Header title="Загальні налаштування" onMenuClick={onMenuClick} />
      <div className="app-content">
        {toast && (
          <div style={{
            position: 'fixed', top: 80, right: 24, zIndex: 1000,
            background: toast.startsWith('❌') ? 'var(--accent-danger)' : 'var(--accent-success)',
            color: '#fff', padding: '12px 20px', borderRadius: 'var(--radius-md)',
            fontWeight: 600, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}>{toast}</div>
        )}

        <div className="page-header">
          <div>
            <Link href="/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 4, textDecoration: 'none' }}>
              <ArrowLeft size={14} /> Налаштування
            </Link>
            <h2 className="page-title">Загальні налаштування</h2>
            <div className="page-subtitle">Організація, валюта, часова зона та контакти обʼєкта</div>
          </div>
          <button className="btn btn-primary" onClick={save} disabled={saving || loading || !org}>
            {saving ? <Loader2 size={16} className="animate-pulse" /> : <Save size={16} />} Зберегти
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 64 }}>
            <Loader2 size={24} className="animate-pulse" style={{ display: 'inline-block' }} /> Завантаження...
          </div>
        ) : !org ? (
          <div className="card"><div style={{ padding: 24, color: 'var(--text-tertiary)' }}>Організацію не знайдено.</div></div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><div className="card-title">Організація</div></div>
              <div style={{ padding: 20 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Назва</label>
                    <input className="form-input" value={org.name} onChange={(e) => setOrgField('name', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Ідентифікатор</label>
                    <input className="form-input" value={org.slug} disabled />
                    <div className="form-hint">Використовується в адресах. Зміна ламає наявні посилання.</div>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Часова зона</label>
                    <select className="form-select" value={org.timezone} onChange={(e) => setOrgField('timezone', e.target.value)}>
                      {(TIMEZONES.includes(org.timezone) ? TIMEZONES : [org.timezone, ...TIMEZONES]).map((tz) => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                    <div className="form-hint">Визначає межу доби для заїздів, звітів і нічних задач.</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Основна валюта</label>
                    <select className="form-select" value={org.default_currency} onChange={(e) => setOrgField('default_currency', e.target.value)}>
                      {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <div className="form-hint">Валюта звітів. Наявні операції не перераховуються.</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><div className="card-title">Реквізити для документів</div></div>
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16, lineHeight: 1.6 }}>
                  Ці дані друкуються на інвойсах і показуються гостям. Поки вони порожні,
                  документи виходять без реквізитів.
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Юридична назва</label>
                    <input className="form-input" value={org.legal_name ?? ''} onChange={(e) => setOrgField('legal_name', e.target.value)} placeholder="ТОВ «Назва», s.r.o., GmbH…" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Юридична адреса</label>
                    <input className="form-input" value={org.legal_address ?? ''} onChange={(e) => setOrgField('legal_address', e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">IČO / ЄДРПОУ</label>
                    <input className="form-input" value={org.registration_no ?? ''} onChange={(e) => setOrgField('registration_no', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">DIČ / ПДВ-номер</label>
                    <input className="form-input" value={org.vat_no ?? ''} onChange={(e) => setOrgField('vat_no', e.target.value)} placeholder="CZ12345678" />
                  </div>
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input type="checkbox" className="form-checkbox" checked={!!org.is_vat_payer}
                      onChange={(e) => setOrgField('is_vat_payer', e.target.checked ? 1 : 0)} />
                    <span style={{ fontSize: 14 }}>Платник ПДВ</span>
                  </label>
                  <div className="form-hint">Впливає на те, як ПДВ показується в інвойсах.</div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Банк</label>
                    <input className="form-input" value={org.bank_name ?? ''} onChange={(e) => setOrgField('bank_name', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Номер рахунку</label>
                    <input className="form-input" value={org.bank_account ?? ''} onChange={(e) => setOrgField('bank_account', e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">IBAN</label>
                    <input className="form-input" value={org.iban ?? ''} onChange={(e) => setOrgField('iban', e.target.value)} placeholder="CZ70 0100 0000 1313 5694 1027" />
                    <div className="form-hint">Друкується на інвойсах — саме на цей рахунок платитимуть гості.</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">SWIFT / BIC</label>
                    <input className="form-input" value={org.swift ?? ''} onChange={(e) => setOrgField('swift', e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Email для документів</label>
                    <input className="form-input" type="email" value={org.invoice_email ?? ''} onChange={(e) => setOrgField('invoice_email', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Сайт</label>
                    <input className="form-input" value={org.website ?? ''} onChange={(e) => setOrgField('website', e.target.value)} placeholder="https://…" />
                  </div>
                </div>
              </div>
            </div>

            {property && (
              <div className="card">
                <div className="card-header"><div className="card-title">Обʼєкт</div></div>
                <div style={{ padding: 20 }}>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Назва обʼєкта</label>
                      <input className="form-input" value={property.name ?? ''} onChange={(e) => setPropField('name', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Місто</label>
                      <input className="form-input" value={property.city ?? ''} onChange={(e) => setPropField('city', e.target.value)} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Адреса</label>
                      <input className="form-input" value={property.address ?? ''} onChange={(e) => setPropField('address', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Країна</label>
                      <input className="form-input" maxLength={2} style={{ textTransform: 'uppercase' }}
                        value={property.country ?? ''} onChange={(e) => setPropField('country', e.target.value.toUpperCase())} />
                      <div className="form-hint">Двобуквений код, напр. CZ</div>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Телефон</label>
                      <input className="form-input" value={property.phone ?? ''} onChange={(e) => setPropField('phone', e.target.value)} />
                      <div className="form-hint">Показується гостям у листах і на гостьовій сторінці.</div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Email</label>
                      <input className="form-input" type="email" value={property.email ?? ''} onChange={(e) => setPropField('email', e.target.value)} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Час заїзду</label>
                      <input className="form-input" type="time" value={property.check_in_time ?? '15:00'} onChange={(e) => setPropField('check_in_time', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Час виїзду</label>
                      <input className="form-input" type="time" value={property.check_out_time ?? '11:00'} onChange={(e) => setPropField('check_out_time', e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
