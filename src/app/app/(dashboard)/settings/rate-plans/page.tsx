'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import PropertyRequired from '@/components/layout/PropertyRequired';
import Link from 'next/link';
import { ArrowLeft, Plus, Save, Loader2, Tag } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Тарифи обʼєкта: назва, код, валюта, харчування, ціна дитини.
 *
 * Ціни на дати ставляться в календарі («Ціни») — тут лише сам тариф. Тариф
 * без ціни існує і показується, але не продається, і це видно в колонці
 * «є ціна на типах» (інваріант 17). Форма — звичайна акуратність
 * (інваріант 29); строгість — у писачі.
 */

interface RatePlan {
  id: string; propertyId: string; name: string; code: string; currency: string;
  mealPlan: string | null; childExtraGross: number | null; isActive: boolean; pricedUnitTypes: string[];
}

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
  const [form, setForm] = useState({ name: '', code: '', currency: '', meal_plan: '', child_extra_gross: '' });

  const ERRORS: Record<string, string> = {
    code_taken: tUi('Такий код уже є на цьому обʼєкті'),
    currency_locked: tUi('Валюту не змінити: під тарифом уже є ціни'),
    code_invalid: tUi('Код — латинські літери, цифри, дефіс, до 20 знаків'),
    currency_invalid: tUi('Валюта — три латинські літери, як EUR'),
    name_required: tUi('Вкажіть назву'),
    child_price_invalid: tUi('Ціна дитини — невідʼємне число'),
    has_prices: tUi('Під тарифом є ціни — спершу приберіть їх у календарі «Ціни»'),
    mapped: tUi('Тариф уже заведено в менеджері каналів — видалити не можна'),
    in_use: tUi('На тариф є бронювання — видалити не можна'),
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
      ? { name: p.name, code: p.code, currency: p.currency, meal_plan: p.mealPlan ?? '', child_extra_gross: p.childExtraGross == null ? '' : String(p.childExtraGross) }
      : { name: '', code: '', currency: plans[0]?.currency ?? '', meal_plan: '', child_extra_gross: '' });
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
        body: JSON.stringify({ ...form, property_id: propertyId }),
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
  const mealLabel = (m: string) => ({
    '': tUi('не вказано'), room_only: tUi('без харчування'), breakfast: tUi('сніданок'),
    half_board: tUi('напівпансіон'), full_board: tUi('повний пансіон'), all_inclusive: tUi('все включено'),
  } as Record<string, string>)[m] ?? m;

  return (
    <>
      <Header title={tUi('Тарифи')} onMenuClick={onMenuClick} />
      <div className="page-content">
        <div className="page-header">
          <div>
            <Link href="/app/settings" className="btn btn-sm" style={{ marginBottom: 8 }}><ArrowLeft size={14} /> {tUi('Налаштування')}</Link>
            <h2 className="page-title"><Tag size={18} style={{ display: 'inline', marginRight: 6 }} />{tUi('Тарифи обʼєкта')}</h2>
            <div className="page-subtitle">{tUi('Назва, код, валюта, харчування, ціна дитини. Ціни на дати — в календарі «Ціни»')}</div>
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
              <label>{tUi('Ціна дитини за ніч')}<input className="form-input" type="number" min={0} step="0.01" value={form.child_extra_gross} onChange={(e) => setForm({ ...form, child_extra_gross: e.target.value })} placeholder={tUi('не вказано')} /></label>
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? <Loader2 size={14} className="animate-pulse" /> : <Save size={14} />} {tUi('Зберегти')}</button>
              <button className="btn" disabled={busy} onClick={() => setEditing(null)}>{tUi('Скасувати')}</button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
              {tUi('Валюту можна змінити лише доки під тарифом немає цін: у менеджері каналів тариф заведено з нею')}
            </div>
          </div>
        )}

        {loading ? (
          <div className="card"><Loader2 size={16} className="animate-pulse" /> {tUi('Завантаження...')}</div>
        ) : plans.length === 0 ? (
          <div className="card">{tUi('Тарифів ще немає. Створіть перший — наприклад, Best Available Rate з кодом BAR')}</div>
        ) : (
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{tUi('Код')}</th>
                  <th>{tUi('Назва')}</th>
                  <th>{tUi('Валюта')}</th>
                  <th>{tUi('Харчування')}</th>
                  <th>{tUi('Ціна дитини за ніч')}</th>
                  <th>{tUi('Є ціна на типах')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td><code>{p.code}</code></td>
                    <td>{p.name}</td>
                    <td>{p.currency}</td>
                    <td>{mealLabel(p.mealPlan ?? '')}</td>
                    <td>{p.childExtraGross == null ? '—' : p.childExtraGross}</td>
                    <td>{p.pricedUnitTypes.length ? p.pricedUnitTypes.join(', ') : <span style={{ color: 'var(--accent-warning)' }}>{tUi('немає — не продається')}</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" disabled={busy} onClick={() => startEdit(p)}>{tUi('Змінити')}</button>
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
