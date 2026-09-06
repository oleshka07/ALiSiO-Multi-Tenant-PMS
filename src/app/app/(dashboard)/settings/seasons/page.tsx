'use client';

/**
 * Налаштування → Сезони (Блок 2 крок 1, Ц27; джерело форми — Hoteliera
 * `org-settings-seasons`, walk-01 «Add season»).
 *
 * Сезон — періоди року обʼєкта без перетинів; у кожному — клітинка ціни на
 * тип × тариф (колонка «Базова» — ціна типу, решта — тарифи). Запис клітинки
 * розгортає ночі сезону в календар тим самим писачем, що масовий редактор;
 * дата, поставлена рукою в календарі, при цьому лишається — прибрати такі
 * перевизначення можна окремою кнопкою. Форма — звичайна акуратність
 * (інваріант 29): усе залізне живе в писачі й його гейті.
 */
import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import PropertyRequired from '@/components/layout/PropertyRequired';
import { EmptyState, LoadingState } from '@/components/ui/State';
import Link from 'next/link';
import { ArrowLeft, Plus, Scissors, Trash2, Loader2, CalendarRange, Eraser } from 'lucide-react';

interface Season { id: string; propertyId: string; name: string; dateFrom: string; dateTo: string; sortOrder: number; cells: number; manualOverrides: number }
interface Cell { id: string; seasonId: string; unitTypeId: string; ratePlanId: string | null; price: number; weekendPrice: number | null }
interface UnitType { id: string; name: string; code: string; property_id: string }
interface RatePlan { id: string; name: string; code: string; isActive: boolean; pricingType?: 'manual' | 'derived' }

export default function SeasonsSettingsPage() {
  const t = useT();
  const onMenuClick = useMobileMenu();
  const ERRORS: Record<string, string> = {
    season_overlap: t('Сезон перетинається з іншим — межі мають іти одна за одною'),
    season_dates_invalid: t('Перевірте дати: кінець не раніше початку'),
    season_name_required: t('Назва обовʼязкова'),
    season_split_invalid: t('Дата поділу має бути всередині сезону, не на першому дні'),
    price_not_positive: t('Ціна має бути більшою за нуль'),
    rate_plan_derived: t('Похідний тариф рахується від бази — клітинки сезону в нього немає'),
  };
  const { propertyId } = usePropertyScope();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitType[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [includePast, setIncludePast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<{ id: string | null; name: string; dateFrom: string; dateTo: string } | null>(null);
  const [draft, setDraft] = useState<Record<string, { price: string; weekend: string }>>({});

  const say = (code: string | undefined, fallback: string) => setError(code && ERRORS[code] ? ERRORS[code] : t(fallback));

  const load = useCallback(async (pid: string) => {
    setLoading(true);
    setError('');
    try {
      const [s, u, r] = await Promise.all([
        fetch(`/api/pricing/seasons?property_id=${encodeURIComponent(pid)}${includePast ? '&include_past=1' : ''}`).then((x) => x.json()),
        fetch('/api/unit-types').then((x) => x.json()),
        fetch(`/api/pricing/rate-plans?property_id=${encodeURIComponent(pid)}`).then((x) => x.json()),
      ]);
      setSeasons(Array.isArray(s) ? s : []);
      setUnitTypes((Array.isArray(u) ? u : []).filter((x: UnitType) => !x.property_id || x.property_id === pid));
      // Похідні тарифи (Ц28) колонки не мають: їх рядки рахує перерендер бази.
      setRatePlans((Array.isArray(r) ? r : []).filter((p: RatePlan) => p.isActive && p.pricingType !== 'derived'));
    } catch {
      setError(t('Не вдалося завантажити сезони'));
    } finally {
      setLoading(false);
    }
  }, [includePast, t]);

  useEffect(() => { if (propertyId) load(propertyId); }, [propertyId, load]);

  const loadCells = useCallback(async (seasonId: string) => {
    const res = await fetch(`/api/pricing/seasons/${seasonId}/prices`);
    const rows = res.ok ? await res.json() : [];
    setCells(Array.isArray(rows) ? rows : []);
    const next: Record<string, { price: string; weekend: string }> = {};
    for (const c of rows as Cell[]) next[`${c.unitTypeId}|${c.ratePlanId ?? ''}`] = { price: String(c.price), weekend: c.weekendPrice == null ? '' : String(c.weekendPrice) };
    setDraft(next);
  }, []);

  useEffect(() => { if (selected) loadCells(selected); else setCells([]); }, [selected, loadCells]);

  const current = useMemo(() => seasons.find((s) => s.id === selected) ?? null, [seasons, selected]);

  const saveSeason = async () => {
    if (!form || !propertyId) return;
    setBusy('form');
    setError('');
    try {
      const res = await fetch(form.id ? `/api/pricing/seasons/${form.id}` : '/api/pricing/seasons', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId, name: form.name, date_from: form.dateFrom, date_to: form.dateTo }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { say(body?.error, 'Не вдалося зберегти сезон'); return; }
      setForm(null);
      await load(propertyId);
      if (!form.id) setSelected(body.id);
    } finally {
      setBusy(null);
    }
  };

  const removeSeason = async (s: Season) => {
    if (!propertyId) return;
    if (!confirm(t('Видалити сезон? Ціни, вже розгорнуті в календар, лишаться.'))) return;
    setBusy(s.id);
    const res = await fetch(`/api/pricing/seasons/${s.id}`, { method: 'DELETE' });
    if (!res.ok) say((await res.json().catch(() => ({})))?.error, 'Не вдалося видалити сезон');
    if (selected === s.id) setSelected(null);
    await load(propertyId);
    setBusy(null);
  };

  const split = async (s: Season) => {
    if (!propertyId) return;
    const date = prompt(t('Дата поділу (YYYY-MM-DD) — з цього дня починається другий сезон'), s.dateFrom);
    if (!date) return;
    setBusy(s.id);
    const res = await fetch(`/api/pricing/seasons/${s.id}/split`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }) });
    if (!res.ok) say((await res.json().catch(() => ({})))?.error, 'Не вдалося поділити сезон');
    await load(propertyId);
    setBusy(null);
  };

  const saveCell = async (unitTypeId: string, ratePlanId: string | null) => {
    if (!current) return;
    const key = `${unitTypeId}|${ratePlanId ?? ''}`;
    const d = draft[key] ?? { price: '', weekend: '' };
    const existing = cells.find((c) => c.unitTypeId === unitTypeId && (c.ratePlanId ?? null) === ratePlanId);
    setBusy(key);
    setError('');
    try {
      if (d.price.trim() === '') {
        if (existing) {
          const q = new URLSearchParams({ unit_type_id: unitTypeId, ...(ratePlanId ? { rate_plan_id: ratePlanId } : {}) });
          const res = await fetch(`/api/pricing/seasons/${current.id}/prices?${q}`, { method: 'DELETE' });
          if (!res.ok) say((await res.json().catch(() => ({})))?.error, 'Не вдалося прибрати клітинку');
        }
      } else {
        const res = await fetch(`/api/pricing/seasons/${current.id}/prices`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unit_type_id: unitTypeId, rate_plan_id: ratePlanId, price: Number(d.price), weekend_price: d.weekend.trim() === '' ? null : Number(d.weekend) }),
        });
        if (!res.ok) say((await res.json().catch(() => ({})))?.error, 'Не вдалося зберегти ціну сезону');
      }
      await loadCells(current.id);
      if (propertyId) await load(propertyId);
    } finally {
      setBusy(null);
    }
  };

  const clearOverrides = async () => {
    if (!current) return;
    if (!confirm(t('Прибрати всі точкові перевизначення дат у цьому сезоні? Ціни з календаря, поставлені рукою, замінить ціна сезону.'))) return;
    setBusy('clear');
    const res = await fetch(`/api/pricing/seasons/${current.id}/clear-overrides`, { method: 'POST' });
    if (!res.ok) say((await res.json().catch(() => ({})))?.error, 'Не вдалося прибрати перевизначення');
    if (propertyId) await load(propertyId);
    setBusy(null);
  };

  const columns: { id: string | null; label: string }[] = [{ id: null, label: t('Базова') }, ...ratePlans.map((p) => ({ id: p.id, label: p.code }))];

  return (
    <>
      <Header title={t('Сезони')} onMenuClick={onMenuClick} />
      <div className="app-content">
        <Link href="/app/settings" className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }}><ArrowLeft size={14} /> {t('Налаштування')}</Link>
        <PropertyRequired>
          {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: 0 }}>
              {t('Періоди року без перетинів. Ціна клітинки розгортається в календар; дата, поставлена рукою в календарі, лишається.')}
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} /> {t('показати минулі')}
              </label>
              <button className="btn btn-primary btn-sm" onClick={() => setForm({ id: null, name: '', dateFrom: '', dateTo: '' })}><Plus size={14} /> {t('Додати сезон')}</button>
            </div>
          </div>

          {form && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="form-row">
                <div className="form-group"><label className="form-label">{t('Назва')}</label>
                  <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('Високий сезон')} /></div>
                <div className="form-group"><label className="form-label">{t('Перша ніч')}</label>
                  <input className="form-input" type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} /></div>
                <div className="form-group"><label className="form-label">{t('Остання ніч (входить)')}</label>
                  <input className="form-input" type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} /></div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={busy === 'form'} onClick={saveSeason}>{busy === 'form' ? <Loader2 size={14} className="animate-pulse" /> : null} {t('Зберегти')}</button>
                <button className="btn btn-sm" onClick={() => setForm(null)}>{t('Скасувати')}</button>
              </div>
            </div>
          )}

          {loading ? <LoadingState /> : seasons.length === 0 ? (
            <EmptyState icon={<CalendarRange size={28} />} title={t('Сезонів ще немає')} hint={t('Додайте перший сезон і поставте в ньому ціну на кожен тип номера — вона розгорнеться в календар на всі його ночі.')} />
          ) : (
            <div className="table-wrapper" style={{ marginBottom: 16 }}>
              <table className="table">
                <thead><tr><th>{t('Назва')}</th><th>{t('Перша ніч')}</th><th>{t('Остання ніч')}</th><th>{t('Клітинок')}</th><th></th></tr></thead>
                <tbody>
                  {seasons.map((s) => (
                    <tr key={s.id} style={selected === s.id ? { background: 'var(--bg-tertiary)' } : undefined}>
                      <td><button className="btn btn-ghost btn-sm" style={{ fontWeight: 600 }} onClick={() => setSelected(s.id)}>{s.name}</button></td>
                      <td>{s.dateFrom}</td>
                      <td>{s.dateTo}</td>
                      <td>{s.cells}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setForm({ id: s.id, name: s.name, dateFrom: s.dateFrom, dateTo: s.dateTo })}>{t('Змінити')}</button>
                        <button className="btn btn-ghost btn-sm" title={t('Поділити')} disabled={busy === s.id} onClick={() => split(s)}><Scissors size={14} /></button>
                        <button className="btn btn-ghost btn-sm" title={t('Видалити')} disabled={busy === s.id} onClick={() => removeSeason(s)}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {current && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{current.name} · {current.dateFrom} – {current.dateTo}</h3>
                <button className="btn btn-sm" disabled={busy === 'clear'} onClick={clearOverrides} title={t('Замінити ціни, поставлені рукою на дати цього сезону, ціною сезону')}>
                  <Eraser size={14} /> {t('Прибрати перевизначення')}
                </button>
              </div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 0 }}>
                {t('Ціна за ніч і, за бажанням, ціна вихідних. Порожня клітинка — тариф у цьому сезоні успадковує базову ціну типу. Зберігається при виході з поля.')}
              </p>
              {/* Рецензія 07.09 п.5: після 0068 усі наявні рядки календаря — ручні
                  перевизначення, і новий сезон у готелі з набраним календарем нічого
                  не змінить, доки їх не прибрати. Це має бути сказано оператору. */}
              {current.manualOverrides > 0 && (
                <div className="login-error" style={{ marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{t('Ночей із ручними перевизначеннями в цьому сезоні')}: <strong>{current.manualOverrides}</strong> — {t('ціна сезону на них не діє')}</span>
                  <button className="btn btn-sm" disabled={busy === 'clear'} onClick={clearOverrides}>{t('Прибрати перевизначення')}</button>
                </div>
              )}
              {unitTypes.length === 0 ? <EmptyState title={t('Немає типів номерів')} hint={t('Спершу заведіть типи номерів у Налаштування → Типи номерів і номери.')} /> : (
                <div className="table-wrapper">
                  <table className="table">
                    <thead><tr><th>{t('Тип номера')}</th>{columns.map((c) => <th key={c.id ?? 'base'}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {unitTypes.map((u) => (
                        <tr key={u.id}>
                          <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{u.code} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>{u.name}</span></td>
                          {columns.map((c) => {
                            const key = `${u.id}|${c.id ?? ''}`;
                            const d = draft[key] ?? { price: '', weekend: '' };
                            const set = (patch: Partial<{ price: string; weekend: string }>) => setDraft({ ...draft, [key]: { ...d, ...patch } });
                            return (
                              <td key={key} style={{ minWidth: 150 }}>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <input className="form-input" style={{ width: 80 }} inputMode="decimal" placeholder={t('ніч')} value={d.price}
                                    onChange={(e) => set({ price: e.target.value })} onBlur={() => saveCell(u.id, c.id)} disabled={busy === key} />
                                  <input className="form-input" style={{ width: 80 }} inputMode="decimal" placeholder={t('вихідні')} value={d.weekend}
                                    onChange={(e) => set({ weekend: e.target.value })} onBlur={() => saveCell(u.id, c.id)} disabled={busy === key} />
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </PropertyRequired>
      </div>
    </>
  );
}
