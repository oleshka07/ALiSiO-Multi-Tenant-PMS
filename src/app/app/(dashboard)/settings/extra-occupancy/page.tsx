'use client';

/**
 * Налаштування → Надбавки за заселеність (Блок 2 крок 3, Ц30; форма — з
 * Hoteliera «Extra occupancy»).
 *
 * Ніч = ціна тарифу за базову заселеність типу + надбавка за кожного дорослого
 * понад базу + надбавка за кожну дитину за її віковою вилкою. Правило: тариф
 * (або всі), тип (або всі), гість (дорослий / дитина з вилкою або на всі
 * вилки), проживання і харчування — кожне відсотком від ціни ночі або сумою,
 * прапорець додаткового ліжка. Точніше правило перебиває загальне.
 *
 * Форма — звичайна акуратність (інваріант 29): усе залізне живе в писачі
 * (`extra-occupancy.repo.ts`) і його гейті. Вікові вилки правляться в
 * Загальних налаштуваннях — тут вони лише читаються.
 */
import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import PropertyRequired from '@/components/layout/PropertyRequired';
import { EmptyState, LoadingState } from '@/components/ui/State';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Loader2, Baby } from 'lucide-react';

type Mode = 'fixed' | 'percent';
interface Rule {
  id: string; ratePlanId: string | null; unitTypeId: string | null; guestKind: 'adult' | 'child'; ageBandIndex: number | null;
  lodgingMode: Mode | null; lodgingValue: number | null; mealMode: Mode | null; mealValue: number | null; extraBed: boolean;
}
interface Band { from: number; to: number }
interface UnitType { id: string; name: string; code: string; property_id: string }
interface RatePlan { id: string; name: string; code: string; isActive: boolean }
interface Form {
  id: string | null; ratePlanId: string; unitTypeId: string; guestKind: 'adult' | 'child'; ageBandIndex: string;
  lodgingMode: Mode | ''; lodgingValue: string; mealMode: Mode | ''; mealValue: string; extraBed: boolean;
}

const EMPTY: Form = { id: null, ratePlanId: '', unitTypeId: '', guestKind: 'adult', ageBandIndex: '', lodgingMode: 'fixed', lodgingValue: '', mealMode: '', mealValue: '', extraBed: false };

export default function ExtraOccupancySettingsPage() {
  const t = useT();
  const onMenuClick = useMobileMenu();
  const ERRORS: Record<string, string> = {
    rule_conflict: t('На цю клітинку (тариф × тип × гість × вилка) правило вже є — змініть його'),
    rule_invalid: t('Перевірте правило: потрібне проживання або харчування, значення не відʼємні, вилка — з наявних'),
    rate_plan_not_found: t('Тариф не знайдено'),
    unit_type_not_found: t('Тип номера не знайдено'),
  };
  const { propertyId } = usePropertyScope();
  const [rules, setRules] = useState<Rule[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitType[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<Form | null>(null);

  const say = (code: string | undefined, fallback: string) => setError(code && ERRORS[code] ? ERRORS[code] : t(fallback));

  const load = useCallback(async (pid: string) => {
    setLoading(true);
    setError('');
    try {
      const [r, u, p] = await Promise.all([
        fetch(`/api/pricing/extra-occupancy?property_id=${encodeURIComponent(pid)}`).then((x) => x.json()),
        fetch('/api/unit-types').then((x) => x.json()),
        fetch(`/api/pricing/rate-plans?property_id=${encodeURIComponent(pid)}`).then((x) => x.json()),
      ]);
      setRules(Array.isArray(r?.rules) ? r.rules : []);
      setBands(Array.isArray(r?.bands) ? r.bands : []);
      setUnitTypes((Array.isArray(u) ? u : []).filter((x: UnitType) => !x.property_id || x.property_id === pid));
      setRatePlans((Array.isArray(p) ? p : []).filter((x: RatePlan) => x.isActive));
    } catch {
      setError(t('Не вдалося завантажити надбавки'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { if (propertyId) load(propertyId); }, [propertyId, load]);

  const planLabel = (id: string | null) => (id == null ? t('Усі тарифи') : (ratePlans.find((p) => p.id === id)?.code ?? '—'));
  const typeLabel = (id: string | null) => (id == null ? t('Усі типи') : (unitTypes.find((u) => u.id === id)?.code ?? '—'));
  const bandLabel = (i: number | null) => (i == null ? t('усі вилки') : (bands[i] ? `${bands[i].from}–${bands[i].to}` : `#${i}`));
  const partLabel = (mode: Mode | null, value: number | null) => (mode == null || value == null ? '—' : mode === 'percent' ? `${value} %` : String(value));

  const edit = (r: Rule) => setForm({
    id: r.id, ratePlanId: r.ratePlanId ?? '', unitTypeId: r.unitTypeId ?? '', guestKind: r.guestKind, ageBandIndex: r.ageBandIndex == null ? '' : String(r.ageBandIndex),
    lodgingMode: r.lodgingMode ?? '', lodgingValue: r.lodgingValue == null ? '' : String(r.lodgingValue),
    mealMode: r.mealMode ?? '', mealValue: r.mealValue == null ? '' : String(r.mealValue), extraBed: r.extraBed,
  });

  const save = async () => {
    if (!form || !propertyId) return;
    setBusy('form');
    setError('');
    try {
      const body = {
        property_id: propertyId,
        rate_plan_id: form.ratePlanId || null,
        unit_type_id: form.unitTypeId || null,
        guest_kind: form.guestKind,
        age_band_index: form.guestKind === 'child' && form.ageBandIndex !== '' ? Number(form.ageBandIndex) : null,
        lodging_mode: form.lodgingMode || null,
        lodging_value: form.lodgingMode ? form.lodgingValue : null,
        meal_mode: form.mealMode || null,
        meal_value: form.mealMode ? form.mealValue : null,
        extra_bed: form.extraBed,
      };
      const res = await fetch(form.id ? `/api/pricing/extra-occupancy/${form.id}` : '/api/pricing/extra-occupancy', {
        method: form.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { say(data?.error, 'Не вдалося зберегти правило'); return; }
      setForm(null);
      await load(propertyId);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: Rule) => {
    if (!propertyId) return;
    if (!confirm(t('Видалити правило? Гість без правила — ніч без ціни, не безкоштовний гість.'))) return;
    setBusy(r.id);
    const res = await fetch(`/api/pricing/extra-occupancy/${r.id}`, { method: 'DELETE' });
    if (!res.ok) say((await res.json().catch(() => ({})))?.error, 'Не вдалося видалити правило');
    await load(propertyId);
    setBusy(null);
  };

  const modeSelect = (value: Mode | '', onChange: (m: Mode | '') => void) => (
    <select className="form-input" value={value} onChange={(e) => onChange(e.target.value as Mode | '')}>
      <option value="">{t('немає')}</option>
      <option value="fixed">{t('сума за ніч')}</option>
      <option value="percent">{t('% від ціни ночі')}</option>
    </select>
  );

  return (
    <>
      <Header title={t('Надбавки за заселеність')} onMenuClick={onMenuClick} />
      <div className="app-content">
        <Link href="/app/settings" className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }}><ArrowLeft size={14} /> {t('Налаштування')}</Link>
        <PropertyRequired>
          {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: 0, maxWidth: 720 }}>
              {t('Ціна тарифу — за базову заселеність типу. Кожен дорослий понад базу і кожна дитина доплачують за правилом: точніше (тариф × тип) перебиває загальне. Дитина без правила — ніч без ціни.')}
              {' '}
              <span>{t('Вікові вилки')}: {bands.map((b) => `${b.from}–${b.to}`).join(', ')} · <Link href="/app/settings/general">{t('змінити')}</Link></span>
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => setForm({ ...EMPTY })}><Plus size={14} /> {t('Додати правило')}</button>
          </div>

          {form && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="form-row">
                <div className="form-group"><label className="form-label">{t('Тариф')}</label>
                  <select className="form-input" value={form.ratePlanId} onChange={(e) => setForm({ ...form, ratePlanId: e.target.value })}>
                    <option value="">{t('Усі тарифи')}</option>
                    {ratePlans.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select></div>
                <div className="form-group"><label className="form-label">{t('Тип номера')}</label>
                  <select className="form-input" value={form.unitTypeId} onChange={(e) => setForm({ ...form, unitTypeId: e.target.value })}>
                    <option value="">{t('Усі типи')}</option>
                    {unitTypes.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                  </select></div>
                <div className="form-group"><label className="form-label">{t('Гість')}</label>
                  <select className="form-input" value={form.guestKind} onChange={(e) => setForm({ ...form, guestKind: e.target.value as 'adult' | 'child', ageBandIndex: '' })}>
                    <option value="adult">{t('Дорослий понад базу')}</option>
                    <option value="child">{t('Дитина')}</option>
                  </select></div>
                {form.guestKind === 'child' && (
                  <div className="form-group"><label className="form-label">{t('Вікова вилка')}</label>
                    <select className="form-input" value={form.ageBandIndex} onChange={(e) => setForm({ ...form, ageBandIndex: e.target.value })}>
                      <option value="">{t('усі вилки')}</option>
                      {bands.map((b, i) => <option key={i} value={String(i)}>{b.from}–{b.to}</option>)}
                    </select></div>
                )}
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">{t('Проживання')}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {modeSelect(form.lodgingMode, (m) => setForm({ ...form, lodgingMode: m }))}
                    <input className="form-input" style={{ width: 110 }} inputMode="decimal" disabled={!form.lodgingMode} value={form.lodgingValue} onChange={(e) => setForm({ ...form, lodgingValue: e.target.value })} />
                  </div></div>
                <div className="form-group"><label className="form-label">{t('Харчування')}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {modeSelect(form.mealMode, (m) => setForm({ ...form, mealMode: m }))}
                    <input className="form-input" style={{ width: 110 }} inputMode="decimal" disabled={!form.mealMode} value={form.mealValue} onChange={(e) => setForm({ ...form, mealValue: e.target.value })} />
                  </div></div>
                <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.extraBed} onChange={(e) => setForm({ ...form, extraBed: e.target.checked })} /> {t('Додаткове ліжко')}
                  </label>
                </div>
              </div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 0 }}>
                {t('Нуль — «безкоштовно», і його називає готель. Відсоток рахується від ціни ночі за базову заселеність.')}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={busy === 'form'} onClick={save}>{busy === 'form' ? <Loader2 size={14} className="animate-pulse" /> : null} {t('Зберегти')}</button>
                <button className="btn btn-sm" onClick={() => setForm(null)}>{t('Скасувати')}</button>
              </div>
            </div>
          )}

          {loading ? <LoadingState /> : rules.length === 0 ? (
            <EmptyState icon={<Baby size={28} />} title={t('Правил ще немає')} hint={t('Без правила третій дорослий коштує різницю з таблиці «Ціни за заселеністю», а дитина — ніч без ціни. Додайте правило для дорослого понад базу і для дитини.')} />
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead><tr>
                  <th>{t('Тариф')}</th><th>{t('Тип номера')}</th><th>{t('Гість')}</th><th>{t('Вилка')}</th>
                  <th>{t('Проживання')}</th><th>{t('Харчування')}</th><th>{t('Дод. ліжко')}</th><th></th>
                </tr></thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <td>{planLabel(r.ratePlanId)}</td>
                      <td>{typeLabel(r.unitTypeId)}</td>
                      <td>{r.guestKind === 'adult' ? t('Дорослий понад базу') : t('Дитина')}</td>
                      <td>{r.guestKind === 'child' ? bandLabel(r.ageBandIndex) : '—'}</td>
                      <td>{partLabel(r.lodgingMode, r.lodgingValue)}</td>
                      <td>{partLabel(r.mealMode, r.mealValue)}</td>
                      <td>{r.extraBed ? t('так') : '—'}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => edit(r)}>{t('Змінити')}</button>
                        <button className="btn btn-ghost btn-sm" title={t('Видалити')} disabled={busy === r.id} onClick={() => remove(r)}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PropertyRequired>
      </div>
    </>
  );
}
