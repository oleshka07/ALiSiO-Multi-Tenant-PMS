'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import Header from '@/components/layout/Header';
import SecondaryCurrencies from './_components/SecondaryCurrencies';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import PropertyRequired from '@/components/layout/PropertyRequired';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  default_currency: string;
  language: string;
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
  ocr_cloud_fallback: number;
  /** Вікові межі дітей (Ц30): у формі — «3, 12»; з бази приходить JSON-список. */
  child_age_bands: string;
}

/** `[3,12]` з бази → «3, 12» у полі; порожньо — одна вилка 0–17. */
function bandsText(raw: unknown): string {
  try {
    const parsed = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed.join(', ') : '';
  } catch {
    return String(raw ?? '');
  }
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
  const t = useT();
  const onMenuClick = useMobileMenu();
  const [org, setOrg] = useState<Organization | null>(null);
  // Форма обʼєкта — ОБРАНОГО в шапці (область обʼєкта). Без параметра
  // сервер віддавав перший за датою створення, і в готелю з двома цей екран
  // мовчки редагував не той (check-property-scope).
  const { propertyId } = usePropertyScope();
  const [propertyForm, setPropertyForm] = useState<Property | null>(null);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [languages, setLanguages] = useState<{ code: string; native: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3200); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/general${propertyId ? `?property_id=${encodeURIComponent(propertyId)}` : ''}`);
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${t(data.error)}`); return; }
      setOrg({ ...data.organization, child_age_bands: bandsText(data.organization?.child_age_bands) });
      setPropertyForm(data.property);
      setCurrencies(data.currencies ?? []);
      setLanguages(data.languages ?? []);
    } catch (e: any) {
      showToast(`❌ ${t(e.message)}`);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!org) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/general', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization: org, property: propertyForm }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${t(data.error)}`); return; }
      setOrg({ ...data.organization, child_age_bands: bandsText(data.organization?.child_age_bands) });
      setPropertyForm(data.property);
      showToast(t('✅ Збережено'));
    } catch (e: any) {
      showToast(`❌ ${t(e.message)}`);
    } finally {
      setSaving(false);
    }
  };

  const setOrgField = (k: keyof Organization, v: string | number) => setOrg((p) => (p ? { ...p, [k]: v } : p));
  const setPropField = (k: keyof Property, v: string) => setPropertyForm((p) => (p ? { ...p, [k]: v } : p));

  return (
    <>
      <Header title={t('Загальні налаштування')} onMenuClick={onMenuClick} />
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
            <Link href="/app/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 4, textDecoration: 'none' }}>
              <ArrowLeft size={14} /> {t('Налаштування')}
            </Link>
            <h2 className="page-title">{t('Загальні налаштування')}</h2>
            <div className="page-subtitle">{t('Організація, валюта, часова зона та контакти обʼєкта')}</div>
          </div>
          <button className="btn btn-primary" onClick={save} disabled={saving || loading || !org}>
            {saving ? <Loader2 size={16} className="animate-pulse" /> : <Save size={16} />} {t('Зберегти')}
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 64 }}>
            <Loader2 size={24} className="animate-pulse" style={{ display: 'inline-block' }} /> {t('Завантаження...')}
          </div>
        ) : !org ? (
          <div className="card"><div style={{ padding: 24, color: 'var(--text-tertiary)' }}>{t('Організацію не знайдено.')}</div></div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><div className="card-title">{t('Організація')}</div></div>
              <div style={{ padding: 20 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">{t('Назва')}</label>
                    <input className="form-input" value={org.name} onChange={(e) => setOrgField('name', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('Ідентифікатор')}</label>
                    <input className="form-input" value={org.slug} disabled />
                    <div className="form-hint">{t('Використовується в адресах. Зміна ламає наявні посилання.')}</div>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">{t('Часова зона')}</label>
                    <select className="form-select" value={org.timezone} onChange={(e) => setOrgField('timezone', e.target.value)}>
                      {(TIMEZONES.includes(org.timezone) ? TIMEZONES : [org.timezone, ...TIMEZONES]).map((tz) => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                    <div className="form-hint">{t('Визначає межу доби для заїздів, звітів і нічних задач.')}</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('Основна валюта')}</label>
                    <select className="form-select" value={org.default_currency} onChange={(e) => setOrgField('default_currency', e.target.value)}>
                      {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <div className="form-hint">{t('Валюта, у якій готель веде облік: ціни, фоліо, фактури, звіти. Наявні документи не перераховуються — кожен несе свою валюту рядком.')}</div>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">{t('Базова мова')}</label>
                    <select className="form-select" value={org.language} onChange={(e) => setOrgField('language', e.target.value)}>
                      {languages.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
                    </select>
                    <div className="form-hint">
                      {t('Мова інтерфейсу для всіх, хто не обрав свою, і мова, якою ви вводите назви й описи. Від неї ж перекладається контент для гостей.')}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <SecondaryCurrencies onToast={showToast} />

            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><div className="card-title">{t('Реквізити для документів')}</div></div>
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16, lineHeight: 1.6 }}>
                  {t('Ці дані друкуються на інвойсах і показуються гостям. Поки вони порожні, документи виходять без реквізитів.')}
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">{t('Юридична назва')}</label>
                    <input className="form-input" value={org.legal_name ?? ''} onChange={(e) => setOrgField('legal_name', e.target.value)} placeholder={t('ТОВ «Назва», s.r.o., GmbH…')} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('Юридична адреса')}</label>
                    <input className="form-input" value={org.legal_address ?? ''} onChange={(e) => setOrgField('legal_address', e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">{t('IČO / ЄДРПОУ')}</label>
                    <input className="form-input" value={org.registration_no ?? ''} onChange={(e) => setOrgField('registration_no', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('DIČ / ПДВ-номер')}</label>
                    <input className="form-input" value={org.vat_no ?? ''} onChange={(e) => setOrgField('vat_no', e.target.value)} placeholder="CZ12345678" />
                  </div>
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input type="checkbox" className="form-checkbox" checked={!!org.is_vat_payer}
                      onChange={(e) => setOrgField('is_vat_payer', e.target.checked ? 1 : 0)} />
                    <span style={{ fontSize: 14 }}>{t('Платник ПДВ')}</span>
                  </label>
                  <div className="form-hint">{t('Впливає на те, як ПДВ показується в інвойсах.')}</div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">{t('Банк')}</label>
                    <input className="form-input" value={org.bank_name ?? ''} onChange={(e) => setOrgField('bank_name', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('Номер рахунку')}</label>
                    <input className="form-input" value={org.bank_account ?? ''} onChange={(e) => setOrgField('bank_account', e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">IBAN</label>
                    <input className="form-input" value={org.iban ?? ''} onChange={(e) => setOrgField('iban', e.target.value)} placeholder="CZ70 0100 0000 1313 5694 1027" />
                    <div className="form-hint">{t('Друкується на інвойсах — саме на цей рахунок платитимуть гості.')}</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">SWIFT / BIC</label>
                    <input className="form-input" value={org.swift ?? ''} onChange={(e) => setOrgField('swift', e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">{t('Email для документів')}</label>
                    <input className="form-input" type="email" value={org.invoice_email ?? ''} onChange={(e) => setOrgField('invoice_email', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('Сайт')}</label>
                    <input className="form-input" value={org.website ?? ''} onChange={(e) => setOrgField('website', e.target.value)} placeholder="https://…" />
                  </div>
                </div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><div className="card-title">{t('Документи гостей')}</div></div>
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 14, lineHeight: 1.6 }}>
                  {t('Дані з паспортів і посвідчень зчитуються')} <strong>{t('на цьому сервері')}</strong> {t('— розпізнається машинозчитувана зона, фото нікуди не передається.')}
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={!!org.ocr_cloud_fallback}
                    onChange={(e) => setOrgField('ocr_cloud_fallback', e.target.checked ? 1 : 0)}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ fontSize: 14 }}>
                    {t('Дозволити хмарне розпізнавання, коли локальне не впоралось')}
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, lineHeight: 1.6 }}>
                      {t('Тоді')} <strong>{t('фото документа надсилається в OpenAI (США)')}</strong>{t('. Це передача персональних даних за межі ЄС: потрібно вказати OpenAI як субпроцесора у вашій політиці конфіденційності. Без цього гість просто заповнює поля вручну.')}
                    </div>
                  </span>
                </label>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><div className="card-title">{t('Діти')}</div></div>
              <div style={{ padding: 20 }}>
                <div className="form-group" style={{ maxWidth: 360 }}>
                  <label className="form-label">{t('Вікові межі дітей')}</label>
                  <input className="form-input" value={org.child_age_bands ?? ''} placeholder="3, 12"
                    onChange={(e) => setOrgField('child_age_bands', e.target.value)} />
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.6 }}>
                    {t('З якого віку починається наступна вилка: «3, 12» — це 0–2, 3–11 і 12–17 років; порожньо — одна вилка 0–17. Дорослий — від 18. Надбавка за кожну вилку — у Налаштування → Ціни → Надбавки за заселеність.')}
                  </div>
                </div>
              </div>
            </div>

            {/* Кілька обʼєктів і жодного обраного — просимо обрати в шапці,
                а не показуємо перший. */}
            {!propertyForm && <PropertyRequired>{null}</PropertyRequired>}
            {propertyForm && (
              <div className="card">
                <div className="card-header"><div className="card-title">{t('Обʼєкт')}</div></div>
                <div style={{ padding: 20 }}>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">{t('Назва обʼєкта')}</label>
                      <input className="form-input" value={propertyForm.name ?? ''} onChange={(e) => setPropField('name', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t('Місто')}</label>
                      <input className="form-input" value={propertyForm.city ?? ''} onChange={(e) => setPropField('city', e.target.value)} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">{t('Адреса')}</label>
                      <input className="form-input" value={propertyForm.address ?? ''} onChange={(e) => setPropField('address', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t('Країна')}</label>
                      <input className="form-input" maxLength={2} style={{ textTransform: 'uppercase' }}
                        value={propertyForm.country ?? ''} onChange={(e) => setPropField('country', e.target.value.toUpperCase())} />
                      <div className="form-hint">{t('Двобуквений код, напр. CZ')}</div>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">{t('Телефон')}</label>
                      <input className="form-input" value={propertyForm.phone ?? ''} onChange={(e) => setPropField('phone', e.target.value)} />
                      <div className="form-hint">{t('Показується гостям у листах і на гостьовій сторінці.')}</div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Email</label>
                      <input className="form-input" type="email" value={propertyForm.email ?? ''} onChange={(e) => setPropField('email', e.target.value)} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">{t('Час заїзду')}</label>
                      <input className="form-input" type="time" value={propertyForm.check_in_time ?? '15:00'} onChange={(e) => setPropField('check_in_time', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t('Час виїзду')}</label>
                      <input className="form-input" type="time" value={propertyForm.check_out_time ?? '11:00'} onChange={(e) => setPropField('check_out_time', e.target.value)} />
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
