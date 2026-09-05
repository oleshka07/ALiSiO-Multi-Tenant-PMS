'use client';

/**
 * Налаштування → Правила цін і промо (Блок 2 крок 4, Ц31; форма — з Hoteliera
 * «Price rules» / «Promos»).
 *
 * Правило — знижка чи надбавка до ціни ночі після надбавок за заселеність і до
 * зборів: умови (період проживання / заїзду / виїзду, дні тижня, тарифи,
 * типи, тривалість, за скільки днів заброньовано, заселеність), дія (мінус чи
 * плюс, відсоток чи сума), пріоритет. Промо — те саме правило з кодом, лічить
 * використання, може бути «лише онлайн».
 *
 * Форма — звичайна акуратність (інваріант 29): усе залізне в писачі
 * (`price-rules.repo.ts`) і його гейті.
 */
import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import PropertyRequired from '@/components/layout/PropertyRequired';
import { EmptyState, LoadingState } from '@/components/ui/State';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Loader2, Percent } from 'lucide-react';

type Kind = 'rule' | 'promo';
type Condition = '' | 'period_of_stay' | 'period_of_checkin' | 'period_of_checkout';
interface Rule {
  id: string; name: string; titleForGuest: string | null; kind: Kind; code: string | null;
  conditionKind: Exclude<Condition, ''> | null; dateFrom: string | null; dateTo: string | null; weekDays: number[] | null;
  ratePlanIds: string[] | null; unitTypeIds: string[] | null; minLos: number | null; maxLos: number | null;
  bookedDaysBeforeFrom: number | null; bookedDaysBeforeTo: number | null; occupancyFrom: number | null; occupancyTo: number | null;
  action: 'decrease' | 'increase'; value: number; valueKind: 'percent' | 'fixed'; priority: number; isActive: boolean;
  onlineOnly: boolean; maxUses: number | null; currentUses: number;
}
interface UnitType { id: string; name: string; code: string; property_id: string }
interface RatePlan { id: string; name: string; code: string; isActive: boolean }
interface Form {
  id: string | null; name: string; titleForGuest: string; kind: Kind; code: string; maxUses: string; onlineOnly: boolean;
  conditionKind: Condition; dateFrom: string; dateTo: string; weekDays: number[]; ratePlanIds: string[]; unitTypeIds: string[];
  minLos: string; maxLos: string; bookedFrom: string; bookedTo: string; occFrom: string; occTo: string;
  action: 'decrease' | 'increase'; value: string; valueKind: 'percent' | 'fixed'; priority: string; isActive: boolean;
}

const EMPTY: Form = {
  id: null, name: '', titleForGuest: '', kind: 'rule', code: '', maxUses: '', onlineOnly: false,
  conditionKind: '', dateFrom: '', dateTo: '', weekDays: [], ratePlanIds: [], unitTypeIds: [],
  minLos: '', maxLos: '', bookedFrom: '', bookedTo: '', occFrom: '', occTo: '',
  action: 'decrease', value: '', valueKind: 'percent', priority: '100', isActive: true,
};

export default function PriceRulesSettingsPage() {
  const t = useT();
  const onMenuClick = useMobileMenu();
  const ERRORS: Record<string, string> = {
    rule_name_required: t('Назва обовʼязкова'),
    rule_value_invalid: t('Значення — додатне число; знижка у відсотках менша за 100'),
    rule_invalid: t('Перевірте умови: словники, межі (від ≤ до), дні тижня 1–7, дати'),
    promo_code_required: t('Промо потребує коду без пробілів'),
    promo_code_taken: t('Такий промокод уже є в організації'),
    rate_plan_not_found: t('Тариф не знайдено'),
    unit_type_not_found: t('Тип номера не знайдено'),
  };
  const DAYS = [t('Пн'), t('Вт'), t('Ср'), t('Чт'), t('Пт'), t('Сб'), t('Нд')];
  const { propertyId } = usePropertyScope();
  const [rules, setRules] = useState<Rule[]>([]);
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
        fetch(`/api/pricing/price-rules?property_id=${encodeURIComponent(pid)}`).then((x) => x.json()),
        fetch('/api/unit-types').then((x) => x.json()),
        fetch(`/api/pricing/rate-plans?property_id=${encodeURIComponent(pid)}`).then((x) => x.json()),
      ]);
      setRules(Array.isArray(r) ? r : []);
      setUnitTypes((Array.isArray(u) ? u : []).filter((x: UnitType) => !x.property_id || x.property_id === pid));
      setRatePlans((Array.isArray(p) ? p : []).filter((x: RatePlan) => x.isActive));
    } catch {
      setError(t('Не вдалося завантажити правила'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { if (propertyId) load(propertyId); }, [propertyId, load]);

  const edit = (r: Rule) => setForm({
    id: r.id, name: r.name, titleForGuest: r.titleForGuest ?? '', kind: r.kind, code: r.code ?? '', maxUses: r.maxUses == null ? '' : String(r.maxUses), onlineOnly: r.onlineOnly,
    conditionKind: r.conditionKind ?? '', dateFrom: r.dateFrom ?? '', dateTo: r.dateTo ?? '', weekDays: r.weekDays ?? [], ratePlanIds: r.ratePlanIds ?? [], unitTypeIds: r.unitTypeIds ?? [],
    minLos: r.minLos == null ? '' : String(r.minLos), maxLos: r.maxLos == null ? '' : String(r.maxLos),
    bookedFrom: r.bookedDaysBeforeFrom == null ? '' : String(r.bookedDaysBeforeFrom), bookedTo: r.bookedDaysBeforeTo == null ? '' : String(r.bookedDaysBeforeTo),
    occFrom: r.occupancyFrom == null ? '' : String(r.occupancyFrom), occTo: r.occupancyTo == null ? '' : String(r.occupancyTo),
    action: r.action, value: String(r.value), valueKind: r.valueKind, priority: String(r.priority), isActive: r.isActive,
  });

  const save = async () => {
    if (!form || !propertyId) return;
    setBusy('form');
    setError('');
    try {
      const body = {
        property_id: propertyId, name: form.name, title_for_guest: form.titleForGuest || null, kind: form.kind,
        code: form.kind === 'promo' ? form.code : null, max_uses: form.kind === 'promo' ? form.maxUses : null, online_only: form.kind === 'promo' && form.onlineOnly,
        condition_kind: form.conditionKind || null, date_from: form.dateFrom || null, date_to: form.dateTo || null,
        week_days: form.weekDays, rate_plan_ids: form.ratePlanIds, unit_type_ids: form.unitTypeIds,
        min_los: form.minLos, max_los: form.maxLos, booked_days_before_from: form.bookedFrom, booked_days_before_to: form.bookedTo,
        occupancy_from: form.occFrom, occupancy_to: form.occTo,
        action: form.action, value: form.value, value_kind: form.valueKind, priority: form.priority, is_active: form.isActive,
      };
      const res = await fetch(form.id ? `/api/pricing/price-rules/${form.id}` : '/api/pricing/price-rules', {
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
    if (!confirm(t('Видалити правило? Ціни в каналі перерахуються без нього.'))) return;
    setBusy(r.id);
    const res = await fetch(`/api/pricing/price-rules/${r.id}`, { method: 'DELETE' });
    if (!res.ok) say((await res.json().catch(() => ({})))?.error, 'Не вдалося видалити правило');
    await load(propertyId);
    setBusy(null);
  };

  const toggleActive = async (r: Rule) => {
    if (!propertyId) return;
    setBusy(r.id);
    const res = await fetch(`/api/pricing/price-rules/${r.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: r.name, title_for_guest: r.titleForGuest, kind: r.kind, code: r.code, max_uses: r.maxUses, online_only: r.onlineOnly,
        condition_kind: r.conditionKind, date_from: r.dateFrom, date_to: r.dateTo, week_days: r.weekDays, rate_plan_ids: r.ratePlanIds, unit_type_ids: r.unitTypeIds,
        min_los: r.minLos, max_los: r.maxLos, booked_days_before_from: r.bookedDaysBeforeFrom, booked_days_before_to: r.bookedDaysBeforeTo,
        occupancy_from: r.occupancyFrom, occupancy_to: r.occupancyTo, action: r.action, value: r.value, value_kind: r.valueKind, priority: r.priority,
        is_active: !r.isActive,
      }),
    });
    if (!res.ok) say((await res.json().catch(() => ({})))?.error, 'Не вдалося зберегти правило');
    await load(propertyId);
    setBusy(null);
  };

  const planCode = (id: string) => ratePlans.find((p) => p.id === id)?.code ?? '—';
  const typeCode = (id: string) => unitTypes.find((u) => u.id === id)?.code ?? '—';
  const conditionLabel = (c: Rule['conditionKind']) => c === 'period_of_checkin' ? t('заїзд') : c === 'period_of_checkout' ? t('виїзд') : t('ночі');
  const summary = (r: Rule) => {
    const parts: string[] = [];
    if (r.dateFrom || r.dateTo) parts.push(`${conditionLabel(r.conditionKind)} ${r.dateFrom ?? '…'} – ${r.dateTo ?? '…'}`);
    if (r.weekDays?.length) parts.push(r.weekDays.map((d) => DAYS[d - 1]).join(', '));
    if (r.ratePlanIds?.length) parts.push(r.ratePlanIds.map(planCode).join(', '));
    if (r.unitTypeIds?.length) parts.push(r.unitTypeIds.map(typeCode).join(', '));
    if (r.minLos != null || r.maxLos != null) parts.push(`${t('ночей')} ${r.minLos ?? '…'}–${r.maxLos ?? '…'}`);
    if (r.bookedDaysBeforeFrom != null || r.bookedDaysBeforeTo != null) parts.push(`${t('за днів')} ${r.bookedDaysBeforeFrom ?? '…'}–${r.bookedDaysBeforeTo ?? '…'}`);
    if (r.occupancyFrom != null || r.occupancyTo != null) parts.push(`${t('гостей')} ${r.occupancyFrom ?? '…'}–${r.occupancyTo ?? '…'}`);
    return parts.length ? parts.join(' · ') : t('завжди');
  };
  const actionLabel = (r: Rule) => `${r.action === 'decrease' ? '−' : '+'}${r.value}${r.valueKind === 'percent' ? ' %' : ''}`;
  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <>
      <Header title={t('Правила цін і промо')} onMenuClick={onMenuClick} />
      <div className="app-content">
        <Link href="/app/settings" className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }}><ArrowLeft size={14} /> {t('Налаштування')}</Link>
        <PropertyRequired>
          {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: 0, maxWidth: 760 }}>
              {t('Правило змінює ціну ночі після надбавок за заселеність і до зборів: за пріоритетом (менше число — раніше), кожне на результат попереднього. Правила за датами й днями тижня їдуть у канал; «за скільки днів заброньовано» і промо — лише прямі продажі.')}
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => setForm({ ...EMPTY })}><Plus size={14} /> {t('Додати правило')}</button>
          </div>

          {form && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="form-row">
                <div className="form-group"><label className="form-label">{t('Назва')}</label>
                  <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('Від 3 ночей −10 %')} /></div>
                <div className="form-group"><label className="form-label">{t('Назва для гостя')}</label>
                  <input className="form-input" value={form.titleForGuest} onChange={(e) => setForm({ ...form, titleForGuest: e.target.value })} placeholder={t('Знижка за тривалість')} /></div>
                <div className="form-group"><label className="form-label">{t('Вид')}</label>
                  <select className="form-input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
                    <option value="rule">{t('Правило (діє само)')}</option>
                    <option value="promo">{t('Промо (за кодом)')}</option>
                  </select></div>
                {form.kind === 'promo' && (<>
                  <div className="form-group"><label className="form-label">{t('Промокод')}</label>
                    <input className="form-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SUMMER10" /></div>
                  <div className="form-group"><label className="form-label">{t('Ліміт використань')}</label>
                    <input className="form-input" inputMode="numeric" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder={t('без ліміту')} /></div>
                  <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.onlineOnly} onChange={(e) => setForm({ ...form, onlineOnly: e.target.checked })} /> {t('Лише онлайн (форма бронювання)')}
                    </label>
                  </div>
                </>)}
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">{t('Дія')}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select className="form-input" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as Form['action'] })}>
                      <option value="decrease">{t('Знижка')}</option>
                      <option value="increase">{t('Надбавка')}</option>
                    </select>
                    <input className="form-input" style={{ width: 100 }} inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
                    <select className="form-input" value={form.valueKind} onChange={(e) => setForm({ ...form, valueKind: e.target.value as Form['valueKind'] })}>
                      <option value="percent">{t('% від ціни ночі')}</option>
                      <option value="fixed">{t('сума за ніч')}</option>
                    </select>
                  </div></div>
                <div className="form-group"><label className="form-label">{t('Пріоритет')}</label>
                  <input className="form-input" style={{ width: 100 }} inputMode="numeric" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></div>
                <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> {t('Увімкнено')}
                  </label>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">{t('Період')}</label>
                  <select className="form-input" value={form.conditionKind} onChange={(e) => setForm({ ...form, conditionKind: e.target.value as Condition })}>
                    <option value="">{t('ночі проживання')}</option>
                    <option value="period_of_checkin">{t('дата заїзду')}</option>
                    <option value="period_of_checkout">{t('дата виїзду')}</option>
                  </select></div>
                <div className="form-group"><label className="form-label">{t('З')}</label>
                  <input className="form-input" type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} /></div>
                <div className="form-group"><label className="form-label">{t('По (включно)')}</label>
                  <input className="form-input" type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} /></div>
                <div className="form-group"><label className="form-label">{t('Дні тижня')}</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {DAYS.map((d, i) => (
                      <label key={d} style={{ fontSize: 12, display: 'flex', gap: 3, alignItems: 'center' }}>
                        <input type="checkbox" checked={form.weekDays.includes(i + 1)} onChange={() => setForm({ ...form, weekDays: form.weekDays.includes(i + 1) ? form.weekDays.filter((x) => x !== i + 1) : [...form.weekDays, i + 1] })} /> {d}
                      </label>
                    ))}
                  </div></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">{t('Тарифи (порожньо — усі)')}</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ratePlans.map((p) => (
                      <label key={p.id} style={{ fontSize: 12, display: 'flex', gap: 3, alignItems: 'center' }}>
                        <input type="checkbox" checked={form.ratePlanIds.includes(p.id)} onChange={() => setForm({ ...form, ratePlanIds: toggleIn(form.ratePlanIds, p.id) })} /> {p.code}
                      </label>
                    ))}
                  </div></div>
                <div className="form-group"><label className="form-label">{t('Типи номерів (порожньо — усі)')}</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {unitTypes.map((u) => (
                      <label key={u.id} style={{ fontSize: 12, display: 'flex', gap: 3, alignItems: 'center' }}>
                        <input type="checkbox" checked={form.unitTypeIds.includes(u.id)} onChange={() => setForm({ ...form, unitTypeIds: toggleIn(form.unitTypeIds, u.id) })} /> {u.code}
                      </label>
                    ))}
                  </div></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">{t('Ночей від – до')}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="form-input" style={{ width: 80 }} inputMode="numeric" value={form.minLos} onChange={(e) => setForm({ ...form, minLos: e.target.value })} />
                    <input className="form-input" style={{ width: 80 }} inputMode="numeric" value={form.maxLos} onChange={(e) => setForm({ ...form, maxLos: e.target.value })} />
                  </div></div>
                <div className="form-group"><label className="form-label">{t('Заброньовано за днів від – до')}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="form-input" style={{ width: 80 }} inputMode="numeric" value={form.bookedFrom} onChange={(e) => setForm({ ...form, bookedFrom: e.target.value })} />
                    <input className="form-input" style={{ width: 80 }} inputMode="numeric" value={form.bookedTo} onChange={(e) => setForm({ ...form, bookedTo: e.target.value })} />
                  </div></div>
                <div className="form-group"><label className="form-label">{t('Гостей від – до')}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="form-input" style={{ width: 80 }} inputMode="numeric" value={form.occFrom} onChange={(e) => setForm({ ...form, occFrom: e.target.value })} />
                    <input className="form-input" style={{ width: 80 }} inputMode="numeric" value={form.occTo} onChange={(e) => setForm({ ...form, occTo: e.target.value })} />
                  </div></div>
              </div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 0 }}>
                {t('«Заброньовано за днів» і промо в канал не їдуть — там немає дати бронювання й нема кому назвати код.')}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={busy === 'form'} onClick={save}>{busy === 'form' ? <Loader2 size={14} className="animate-pulse" /> : null} {t('Зберегти')}</button>
                <button className="btn btn-sm" onClick={() => setForm(null)}>{t('Скасувати')}</button>
              </div>
            </div>
          )}

          {loading ? <LoadingState /> : rules.length === 0 ? (
            <EmptyState icon={<Percent size={28} />} title={t('Правил ще немає')} hint={t('Додайте знижку за тривалість, надбавку на вихідні або промокод — вони накладаються на ціну ночі за пріоритетом.')} />
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead><tr>
                  <th>{t('Пріоритет')}</th><th>{t('Назва')}</th><th>{t('Вид')}</th><th>{t('Умови')}</th><th>{t('Дія')}</th><th>{t('Стан')}</th><th></th>
                </tr></thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} style={r.isActive ? undefined : { opacity: 0.6 }}>
                      <td>{r.priority}</td>
                      <td style={{ fontWeight: 600 }}>{r.name}{r.titleForGuest ? <div style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-tertiary)' }}>{r.titleForGuest}</div> : null}</td>
                      <td>{r.kind === 'promo' ? <>{t('Промо')} <code>{r.code}</code>{r.maxUses != null ? ` · ${r.currentUses}/${r.maxUses}` : ''}{r.onlineOnly ? ` · ${t('онлайн')}` : ''}</> : t('Правило')}</td>
                      <td style={{ fontSize: 12 }}>{summary(r)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{actionLabel(r)}</td>
                      <td><button className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => toggleActive(r)}>{r.isActive ? t('увімкнено') : t('вимкнено')}</button></td>
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
