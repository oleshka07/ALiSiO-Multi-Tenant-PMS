'use client';

/**
 * Каса ПРРО одного обʼєкта: реквізити, драйвер, проба і журнал.
 *
 * Свій екран, а не картка на «Застосунках»: там живе стан звʼязку і ключі
 * вендора, а тут — те, чого в жодного іншого застосунку немає, — ЖУРНАЛ.
 * Рецепція питає не «чи підключено», а «що з чеком за цією оплатою», і
 * відповідь на це — список операцій, а не бейдж.
 *
 * Обʼєкт із перемикача в шапці: каса стоїть у будинку (INC-029), і два
 * будинки під одним рахунком мають дві каси. `?? 'all'` — сказане «усі»;
 * реквізити тоді не показуються (їх нема в кого питати), а журнал — обох.
 *
 * Вибір драйвера чесний: `none` — «реєстратора немає», і це не порожній
 * пункт списку, а стан, у якому каса ВІДМОВЛЯЄ названо. Провайдера ще не
 * обрано (docs/research/prro-providers.md), тому третього пункту тут поки
 * немає, і вигадувати його назву було б гірше, ніж не мати.
 */

import { useT } from '@core/i18n/client';
import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Loader2, Receipt, PlayCircle } from 'lucide-react';
import Link from 'next/link';
import { usePropertyScope } from '@/ui/PropertyScopeContext';

interface Settings {
  property_id: string;
  driver: string;
  cashier_name: string | null;
  register_fiscal_number: string | null;
  point_local_number: string | null;
  tax_number: string | null;
}

interface Operation {
  id: string;
  property_id: string;
  kind: string;
  status: string;
  payment_id: string | null;
  shift_id: string | null;
  fiscal_number: string | null;
  total: number | null;
  error: string | null;
  created_at: string;
}

const EMPTY = {
  driver: 'none', cashier_name: '', register_fiscal_number: '',
  point_local_number: '', tax_number: '',
};

export default function FiscalUaPage() {
  const { propertyId } = usePropertyScope();
  const scopeParam = propertyId ?? 'all';
  const t = useT();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [journal, setJournal] = useState<Operation[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const KIND_LABEL: Record<string, string> = {
    shift_open: t('Відкриття зміни'),
    receipt: t('Чек'),
    shift_close: t('Закриття зміни (Z-звіт)'),
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/fiscal-ua/settings?property_id=${encodeURIComponent(scopeParam)}`);
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${t(data.error || 'Не вдалося прочитати налаштування каси')}`); return; }
      setSettings(data.settings ?? null);
      setJournal(data.journal || []);
      setForm(data.settings
        ? {
          driver: data.settings.driver || 'none',
          cashier_name: data.settings.cashier_name || '',
          register_fiscal_number: data.settings.register_fiscal_number || '',
          point_local_number: data.settings.point_local_number || '',
          tax_number: data.settings.tax_number || '',
        }
        : EMPTY);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [scopeParam, t]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Відповідь читається, а не ігнорується: писач віддає названі відмови
  // (чужий обʼєкт — 404, невідомий драйвер — 409), і показати «Збережено»
  // на них означало б збрехати про стан каси.
  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/fiscal-ua/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: settings.property_id, ...form }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${t(data.error || 'Не вдалося зберегти')}`); return; }
      showToast(t('Реквізити каси збережено'));
      fetchAll();
    } catch (e) { console.error(e); showToast(`❌ ${t('Не вдалося зберегти')}`); } finally { setSaving(false); }
  };

  const probe = async () => {
    if (!settings) return;
    setTesting(true);
    try {
      const res = await fetch('/api/fiscal-ua/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: settings.property_id }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${t(data.error || 'Проба не відбулась')}`); return; }
      // 200 і `failed` — це не суперечність: проба відбулась, а каса
      // відмовила, і саме це треба показати.
      showToast(data.status === 'registered'
        ? `${t('Каса відповіла')}: ${data.fiscalNumber}`
        : `❌ ${data.error}`);
      fetchAll();
    } catch (e) { console.error(e); showToast(`❌ ${t('Проба не відбулась')}`); } finally { setTesting(false); }
  };

  return (
    <div className="app-content">
      {toast && (
        <div style={{
          position: 'fixed', top: 80, right: 24, zIndex: 1000,
          background: toast.startsWith('❌') ? 'var(--accent-danger)' : 'var(--accent-success)',
          color: 'var(--text-inverse)', padding: '12px 20px', borderRadius: 'var(--radius-md)',
          fontWeight: 600, fontSize: 14,
        }}>{toast}</div>
      )}

      <div className="page-header">
        <div>
          <Link href="/app/settings" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }}>
            <ArrowLeft size={14} /> {t('Налаштування')}
          </Link>
          <h2 className="page-title">{t('Фіскалізація України (ПРРО)')}</h2>
          <div className="page-subtitle">
            {t('Реквізити каси обʼєкта, драйвер реєстратора і журнал: що каса відповіла на кожен чек')}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          <Loader2 size={20} className="spin" /> {t('Завантаження…')}
        </div>
      ) : !settings ? (
        <div className="card" style={{ padding: 20, color: 'var(--text-secondary)' }}>
          {t('Оберіть обʼєкт у шапці: каса належить будинку, а не рахунку')}
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 16px' }}>{t('Реквізити каси')}</h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
              <label>
                <div className="form-label">{t('Реєстратор')}</div>
                <select className="form-input" value={form.driver}
                  onChange={(e) => setForm({ ...form, driver: e.target.value })}>
                  <option value="none">{t('Немає — каса відмовлятиме')}</option>
                  <option value="test">{t('Тестовий — перевірка шляху без провайдера')}</option>
                </select>
              </label>
              <label>
                <div className="form-label">{t('Касир')}</div>
                <input className="form-input" value={form.cashier_name}
                  onChange={(e) => setForm({ ...form, cashier_name: e.target.value })} />
              </label>
              <label>
                <div className="form-label">{t('Фіскальний номер реєстратора')}</div>
                <input className="form-input" value={form.register_fiscal_number}
                  onChange={(e) => setForm({ ...form, register_fiscal_number: e.target.value })} />
              </label>
              <label>
                <div className="form-label">{t('Локальний номер точки')}</div>
                <input className="form-input" value={form.point_local_number}
                  onChange={(e) => setForm({ ...form, point_local_number: e.target.value })} />
              </label>
              <label>
                <div className="form-label">{t('Податковий номер')}</div>
                <input className="form-input" value={form.tax_number}
                  onChange={(e) => setForm({ ...form, tax_number: e.target.value })} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : null} {t('Зберегти')}
              </button>
              <button className="btn btn-secondary" onClick={probe} disabled={testing}>
                {testing ? <Loader2 size={14} className="spin" /> : <PlayCircle size={14} />} {t('Перевірити касу')}
              </button>
            </div>

            {form.driver === 'none' && (
              <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-secondary)' }}>
                {t('Поки реєстратора немає, готівка й термінал на цьому обʼєкті записуються, але чек не видається — кожна спроба лишає рядок у журналі нижче.')}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Receipt size={16} />
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{t('Журнал каси')}</h3>
            </div>
            {journal.length === 0 ? (
              <div style={{ padding: '0 20px 18px', color: 'var(--text-tertiary)', fontSize: 13 }}>
                {t('Каса ще нічого не казала')}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('Коли')}</th>
                      <th>{t('Що')}</th>
                      <th>{t('Стан')}</th>
                      <th>{t('Фіскальний номер')}</th>
                      <th>{t('Сума')}</th>
                      <th>{t('Причина')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journal.map((op) => (
                      <tr key={op.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{op.created_at}</td>
                        <td>{KIND_LABEL[op.kind] ?? op.kind}</td>
                        <td>
                          <span className={`badge ${op.status === 'registered' ? 'badge-success' : 'badge-danger'}`}>
                            {op.status === 'registered' ? t('зареєстровано') : t('не вдалося')}
                          </span>
                        </td>
                        <td>{op.fiscal_number || '—'}</td>
                        <td>{op.total == null ? '—' : op.total}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{op.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
