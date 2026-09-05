'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import PropertyRequired from '@/components/layout/PropertyRequired';
import { EmptyState, LoadingState } from '@/components/ui/State';
import Link from 'next/link';
import { ArrowLeft, Plus, Save, Loader2, Tag } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Тарифи обʼєкта: назва, код, валюта, харчування, похідні, стан. Ціна
 * дитини й дорослих понад базу — у «Надбавках за заселеність» (Ц30).
 *
 * Ціни на дати ставляться в календарі («Ціни») — тут лише сам тариф. Тариф
 * без ціни існує і показується, але не продається, і це видно в колонці
 * «є ціна на типах» (інваріант 17). Форма — звичайна акуратність
 * (інваріант 29); строгість — у писачі.
 *
 * «Зняти з продажу» (Блок 2.1): заведений у менеджері каналів тариф видалити
 * не можна — його знімають з продажу, і канал закриває всі його ночі до
 * горизонту; ціни в календарі лишаються, «Повернути в продаж» відкриває
 * їх знову. Це кнопка з підтвердженням, а не перемикач: наслідок — у каналі.
 */

interface RatePlan {
  id: string; propertyId: string; name: string; code: string; currency: string;
  mealPlan: string | null; isActive: boolean; pricedUnitTypes: string[];
  sellMode: 'per_room' | 'per_person'; mapped: boolean;
  isHidden: boolean;
  pricingType: 'manual' | 'derived';
  basedOnRatePlanId: string | null;
  adjustment: { kind: 'percent' | 'fixed'; value: number; direction: 'increase' | 'decrease' } | null;
}

const EMPTY_FORM = {
  name: '', code: '', currency: '', meal_plan: '', sell_mode: 'per_person', is_hidden: false,
  pricing_type: 'manual', based_on_rate_plan_id: '', adjustment_kind: 'percent', adjustment_value: '', adjustment_direction: 'decrease',
};

const MEAL_OPTIONS = ['', 'room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive'] as const;

export default function RatePlansSettingsPage() {
  const tUi = useT();
  const onMenuClick = useMobileMenu();

  // Обʼєкт — з області в шапці, не з власного стану (check-property-scope).
  const { propertyId } = usePropertyScope();
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Валюти за замовчуванням немає навмисно (`check-currency`): її називає готель.
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const ERRORS: Record<string, string> = {
    code_taken: tUi('Такий код уже є на цьому обʼєкті'),
    currency_locked: tUi('Валюту не змінити: під тарифом уже є ціни'),
    code_invalid: tUi('Код — латинські літери, цифри, дефіс, до 20 знаків'),
    currency_invalid: tUi('Валюта — три латинські літери, як EUR'),
    name_required: tUi('Вкажіть назву'),
    has_prices: tUi('Під тарифом є ціни — спершу приберіть їх у календарі «Ціни»'),
    mapped: tUi('Тариф уже заведено в менеджері каналів — видалити не можна'),
    in_use: tUi('На тариф є бронювання — видалити не можна'),
    sell_mode_invalid: tUi('Режим ціни — «за номер» або «за особу»'),
    sell_mode_locked: tUi('Режим ціни не змінити: тариф уже заведено в менеджері каналів'),
    based_on_required: tUi('Похідному тарифу потрібна база — оберіть тариф, від якого рахувати'),
    based_on_invalid: tUi('Базою може бути лише звичайний тариф цього обʼєкта — не похідний і не сам тариф'),
    adjustment_invalid: tUi('Коригування — додатне число; відсоток зменшення менший за 100'),
    has_dependents: tUi('На цей тариф спираються похідні — спершу змініть або видаліть їх'),
  };
  const explain = (code: string | undefined) => (code && ERRORS[code]) || tUi('Не вдалося. Спробуйте ще раз');

  const load = useCallback(async (pid: string | null) => {
    setLoading(true);
    try {
      if (!pid) { setPlans([]); return; }
      const res = await fetch(`/api/pricing/rate-plans?property_id=${encodeURIComponent(pid)}`);
      const body = await res.json();
      if (!res.ok) { setNotice({ kind: 'error', text: explain(body?.error) }); return; }
      setPlans(Array.isArray(body) ? body : []);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(propertyId); }, [propertyId, load]);

  const startEdit = (p: RatePlan | null) => {
    setEditing(p ? p.id : 'new');
    setForm(p
      ? {
        name: p.name, code: p.code, currency: p.currency, meal_plan: p.mealPlan ?? '',
        sell_mode: p.sellMode, is_hidden: p.isHidden, pricing_type: p.pricingType, based_on_rate_plan_id: p.basedOnRatePlanId ?? '',
        adjustment_kind: p.adjustment?.kind ?? 'percent', adjustment_value: p.adjustment ? String(p.adjustment.value) : '', adjustment_direction: p.adjustment?.direction ?? 'decrease',
      }
      : { ...EMPTY_FORM, currency: plans[0]?.currency ?? '' });
    setNotice(null);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setNotice(null);
    try {
      const isNew = editing === 'new';
      const res = await fetch(isNew ? '/api/pricing/rate-plans' : `/api/pricing/rate-plans/${editing}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          property_id: propertyId,
          // Похідний (Ц28): база й коригування ідуть лише коли обрано «від іншого тарифу».
          based_on_rate_plan_id: form.pricing_type === 'derived' ? form.based_on_rate_plan_id : null,
          adjustment_kind: form.pricing_type === 'derived' ? form.adjustment_kind : null,
          adjustment_value: form.pricing_type === 'derived' ? form.adjustment_value : null,
          adjustment_direction: form.pricing_type === 'derived' ? form.adjustment_direction : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ kind: 'error', text: explain(body?.error) }); return; }
      setEditing(null);
      setNotice({ kind: 'ok', text: isNew ? tUi('Тариф створено') : tUi('Тариф збережено') });
      await load(propertyId);
    } catch {
      setNotice({ kind: 'error', text: explain(undefined) });
    } finally {
      setBusy(false);
    }
  };

  // Видаляється лише чистий тариф; кожна відмова названа (`ERRORS`).
  // 02.09.2026: тариф ліг не на той обʼєкт, а прибрати його не було чим.
  const remove = async (p: RatePlan) => {
    if (!window.confirm(`${tUi('Видалити тариф')} ${p.code} — ${p.name}?`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/pricing/rate-plans/${p.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ kind: 'error', text: explain(body?.error) }); return; }
      setNotice({ kind: 'ok', text: tUi('Тариф видалено') });
      await load(propertyId);
    } catch {
      setNotice({ kind: 'error', text: explain(undefined) });
    } finally {
      setBusy(false);
    }
  };
  // Зняти з продажу / повернути — через той самий PATCH; канал дізнається
  // з черги (координати до горизонту кладе писач, Ц16).
  const setActive = async (p: RatePlan, active: boolean) => {
    const question = active
      ? `${tUi('Повернути в продаж')} ${p.code} — ${p.name}?`
      : `${tUi('Зняти з продажу')} ${p.code} — ${p.name}? ${tUi('У менеджері каналів усі ночі цього тарифу стануть закритими. Ціни в календарі збережуться')}`;
    if (!window.confirm(question)) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/pricing/rate-plans/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ kind: 'error', text: explain(body?.error) }); return; }
      setNotice({ kind: 'ok', text: active ? tUi('Тариф повернуто в продаж') : tUi('Тариф знято з продажу — канал закриє його ночі') });
      await load(propertyId);
    } catch {
      setNotice({ kind: 'error', text: explain(undefined) });
    } finally {
      setBusy(false);
    }
  };
  const mealLabel = (m: string) => ({
    '': tUi('не вказано'), room_only: tUi('без харчування'), breakfast: tUi('сніданок'),
    half_board: tUi('напівпансіон'), full_board: tUi('повний пансіон'), all_inclusive: tUi('все включено'),
  } as Record<string, string>)[m] ?? m;
  // «BAR −10 %» / «STD +25 EUR» — правило похідного одним рядком.
  const ruleLabel = (p: RatePlan) => {
    if (p.pricingType !== 'derived' || !p.adjustment) return tUi('свої ціни');
    const base = plans.find((x) => x.id === p.basedOnRatePlanId)?.code ?? '?';
    const sign = p.adjustment.direction === 'decrease' ? '−' : '+';
    return `${base} ${sign}${p.adjustment.value}${p.adjustment.kind === 'percent' ? ' %' : ` ${p.currency}`}`;
  };
  // Базою похідного може бути лише звичайний тариф — і не він сам.
  const bases = plans.filter((p) => p.pricingType === 'manual' && p.id !== editing);

  return (
    <>
      <Header title={tUi('Тарифи')} onMenuClick={onMenuClick} />
      <div className="app-content">
        <div className="page-header">
          <div>
            <Link href="/app/settings" className="btn btn-sm" style={{ marginBottom: 8 }}><ArrowLeft size={14} /> {tUi('Налаштування')}</Link>
            <h2 className="page-title"><Tag size={18} style={{ display: 'inline', marginRight: 6 }} />{tUi('Тарифи обʼєкта')}</h2>
            <div className="page-subtitle">{tUi('Назва, код, валюта, харчування, похідні від іншого тарифу. Ціни на дати — в календарі «Ціни» і в сезонах; доплати за гостей — у «Надбавках за заселеність»')}</div>
          </div>
          <button className="btn btn-primary" disabled={!propertyId} onClick={() => startEdit(null)}><Plus size={14} /> {tUi('Додати тариф')}</button>
        </div>

        {/* Обʼєкт обирається в шапці (область обʼєкта): без підпису тарифи
            лягали на перший обʼєкт за датою створення, і ніхто цього не
            помічав (02.09.2026). Тепер екран без обраного обʼєкта просить
            обрати, а не бере перший. */}
        <PropertyRequired>
        {notice && (
          <div className={`alert ${notice.kind === 'ok' ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 12 }}>{notice.text}</div>
        )}

        {editing && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{editing === 'new' ? tUi('Новий тариф') : tUi('Змінити тариф')}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <label>{tUi('Назва')}<input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Best Available Rate" /></label>
              <label>{tUi('Код')}<input className="form-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="BAR" /></label>
              <label>{tUi('Валюта')}<input className="form-input" value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} placeholder="EUR" /></label>
              <label>{tUi('Харчування')}
                <select className="form-select" value={form.meal_plan} onChange={(e) => setForm({ ...form, meal_plan: e.target.value })}>
                  {MEAL_OPTIONS.map((m) => <option key={m} value={m}>{mealLabel(m)}</option>)}
                </select>
              </label>
              {/* Режим ціни (Ц26): обирається при створенні; заведений у каналі тариф його не міняє — набір опцій там не переробити. */}
              <label style={{ minWidth: 0 }}>{tUi('Ціна рахується')}
                <select
                  className="form-select"
                  style={{ width: '100%', minWidth: 0 }}
                  value={form.sell_mode}
                  disabled={editing !== 'new' && !!plans.find((p) => p.id === editing)?.mapped}
                  onChange={(e) => setForm({ ...form, sell_mode: e.target.value })}
                >
                  <option value="per_person">{tUi('за особу')}</option>
                  <option value="per_room">{tUi('за номер')}</option>
                </select>
              </label>
              {/* Похідний тариф (Ц28): ціна = база ± коригування, рендериться в
                  календар; своїх цін не має. Базою — лише звичайний тариф. */}
              <label style={{ minWidth: 0 }}>{tUi('Звідки ціни')}
                <select className="form-select" style={{ width: '100%', minWidth: 0 }} value={form.pricing_type} onChange={(e) => setForm({ ...form, pricing_type: e.target.value })}>
                  <option value="manual">{tUi('свої (календар, сезони)')}</option>
                  <option value="derived">{tUi('від іншого тарифу')}</option>
                </select>
              </label>
              {form.pricing_type === 'derived' && (
                <>
                  <label style={{ minWidth: 0 }}>{tUi('Базовий тариф')}
                    <select className="form-select" style={{ width: '100%', minWidth: 0 }} value={form.based_on_rate_plan_id} onChange={(e) => setForm({ ...form, based_on_rate_plan_id: e.target.value })}>
                      <option value="">{tUi('— оберіть —')}</option>
                      {bases.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                    </select>
                  </label>
                  <label style={{ minWidth: 0 }}>{tUi('Коригування')}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select className="form-select" style={{ minWidth: 0 }} value={form.adjustment_direction} onChange={(e) => setForm({ ...form, adjustment_direction: e.target.value })}>
                        <option value="decrease">−</option>
                        <option value="increase">+</option>
                      </select>
                      <input className="form-input" type="number" min={0} step="0.01" style={{ minWidth: 0 }} value={form.adjustment_value} onChange={(e) => setForm({ ...form, adjustment_value: e.target.value })} placeholder="10" />
                      <select className="form-select" style={{ minWidth: 0 }} value={form.adjustment_kind} onChange={(e) => setForm({ ...form, adjustment_kind: e.target.value })}>
                        <option value="percent">%</option>
                        <option value="fixed">{form.currency || tUi('сума')}</option>
                      </select>
                    </div>
                  </label>
                </>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22 }}>
                <input type="checkbox" checked={form.is_hidden} onChange={(e) => setForm({ ...form, is_hidden: e.target.checked })} />
                {tUi('Не показувати на сайті')}
              </label>
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? <Loader2 size={14} className="animate-pulse" /> : <Save size={14} />} {tUi('Зберегти')}</button>
              <button className="btn" disabled={busy} onClick={() => setEditing(null)}>{tUi('Скасувати')}</button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
              <div>{tUi('Валюту можна змінити лише доки під тарифом немає цін: у менеджері каналів тариф заведено з нею')}</div>
              <div>{tUi('За особу — своя ціна на кожну кількість дорослих (надбавка з матриці заселеності); за номер — одна ціна на будь-яку кількість гостей, без надбавок')}</div>
              <div>{tUi('Режим ціни замикається, щойно тариф заведено в менеджері каналів: набір опцій заселеності там не переробити')}</div>
              <div>{tUi('Похідний тариф рахується від бази на кожну дату і записується в календар сам; дата, поставлена йому рукою в календарі, лишається. Валюта — валюта бази')}</div>
              <div>{tUi('Прихований тариф не показується на сайті й у віджеті і не йде в канал')}</div>
            </div>
          </div>
        )}

        {loading ? (
          <LoadingState />
        ) : plans.length === 0 ? (
          <EmptyState
            title={tUi('Тарифів ще немає')}
            hint={tUi('Створіть перший — наприклад, Best Available Rate з кодом BAR. Тариф без ціни показується, але не продається')}
            action={{ label: tUi('Додати тариф'), onClick: () => startEdit(null), icon: <Plus size={14} /> }}
          />
        ) : (
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{tUi('Код')}</th>
                  <th>{tUi('Назва')}</th>
                  <th>{tUi('Валюта')}</th>
                  <th>{tUi('Харчування')}</th>
                  <th>{tUi('Ціна рахується')}</th>
                  <th>{tUi('Звідки ціни')}</th>
                  <th>{tUi('Є ціна на типах')}</th>
                  <th>{tUi('Стан')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} style={p.isActive ? undefined : { color: 'var(--text-tertiary)' }}>
                    <td><code>{p.code}</code></td>
                    <td>{p.name}</td>
                    <td>{p.currency}</td>
                    <td>{mealLabel(p.mealPlan ?? '')}</td>
                    <td>{p.sellMode === 'per_room' ? tUi('за номер') : tUi('за особу')}</td>
                    <td>{ruleLabel(p)}{p.isHidden ? <span style={{ color: 'var(--text-tertiary)' }}> · {tUi('прихований')}</span> : null}</td>
                    <td>{p.pricedUnitTypes.length ? p.pricedUnitTypes.join(', ') : <span style={{ color: 'var(--accent-warning)' }}>{tUi('немає — не продається')}</span>}</td>
                    <td>
                      {p.isActive
                        ? <span style={{ color: 'var(--accent-success)' }}>{tUi('продається')}</span>
                        : <span style={{ color: 'var(--accent-danger)' }}>{tUi('знято з продажу')}</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" disabled={busy} onClick={() => startEdit(p)}>{tUi('Змінити')}</button>
                      {' '}
                      {p.isActive
                        ? <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setActive(p, false)}>{tUi('Зняти з продажу')}</button>
                        : <button className="btn btn-sm" disabled={busy} onClick={() => setActive(p, true)}>{tUi('Повернути в продаж')}</button>}
                      {' '}
                      <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => remove(p)}>{tUi('Видалити')}</button>
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
