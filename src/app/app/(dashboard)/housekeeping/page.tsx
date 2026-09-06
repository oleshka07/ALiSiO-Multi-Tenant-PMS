'use client';

/**
 * Housekeeping — борд номерів і історія прибирання (Блок 4 §2.2).
 *
 * Джерело форми — Hoteliera «Housekeeping Board / Cleaning History»: номери
 * групами за типом, стан у клітинці, зміна в один клік; поруч — хто в номері,
 * заїзд/виїзд сьогодні, out of order з блокувань. Область обʼєкта — з
 * провайдера (П10), власного `propertyId` екран не тримає.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '@core/i18n/client';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import { EmptyState, LoadingState, ErrorState } from '@/components/ui/State';
import { Sparkles, Brush, Clock, Ban, LogIn, LogOut, RefreshCw } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Cleaning = 'clean' | 'dirty' | 'in_progress';

const NEXT: Record<Cleaning, Cleaning> = { dirty: 'in_progress', in_progress: 'clean', clean: 'dirty' };

export default function HousekeepingPage() {
  const t = useT();
  const onMenuClick = useMobileMenu();
  const { propertyId, properties } = usePropertyScope();
  const [view, setView] = useState<'board' | 'history'>('board');
  const [board, setBoard] = useState<{ today: string; units: any[] } | null>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [filter, setFilter] = useState<'all' | Cleaning | 'out_of_order'>('all');
  const today = new Date().toISOString().slice(0, 10);
  const [hist, setHist] = useState({ from: today, to: today, unitId: '', changedBy: '' });
  // Люди для фільтра «хто» — з завантаженої історії; при фільтрі за людиною
  // список не звужується до неї самої (памʼятаємо всіх, кого вже бачили).
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);

  const scopeQs = propertyId ? `property_id=${propertyId}` : 'property_id=all';

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch(`/api/housekeeping/board?${scopeQs}`);
      if (!res.ok) { setFailed(true); return; }
      setBoard(await res.json());
      setFailed(false);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [scopeQs]);

  const loadHistory = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ from: hist.from, to: hist.to });
      if (propertyId) qs.set('property_id', propertyId);
      if (hist.unitId) qs.set('unit_id', hist.unitId);
      if (hist.changedBy) qs.set('changed_by', hist.changedBy);
      const res = await fetch(`/api/housekeeping/history?${qs}`);
      if (!res.ok) { setFailed(true); return; }
      const rows: any[] = (await res.json()).rows ?? [];
      setHistory(rows);
      setPeople((prev) => {
        const m = new Map(prev.map((p) => [p.id, p.name]));
        for (const r of rows) if (r.changed_by && r.changed_by_name) m.set(String(r.changed_by), String(r.changed_by_name));
        return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
      });
      setFailed(false);
    } catch { setFailed(true); }
  }, [propertyId, hist]);

  useEffect(() => { setLoading(true); loadBoard(); }, [loadBoard]);
  useEffect(() => { if (view === 'history') loadHistory(); }, [view, loadHistory]);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const change = async (unit: any, to: Cleaning) => {
    setBusy(unit.id);
    try {
      const res = await fetch(`/api/housekeeping/units/${unit.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }),
      });
      if (!res.ok) { say(`❌ ${t('Не вдалося змінити стан номера')}`); return; }
      setBoard((b) => b ? { ...b, units: b.units.map((u) => (u.id === unit.id ? { ...u, cleaning_status: to } : u)) } : b);
    } finally { setBusy(null); }
  };

  const label: Record<string, string> = {
    clean: t('Чисто'), dirty: t('Брудно'), in_progress: t('У роботі'), out_of_order: t('Out of order'),
  };
  const tone: Record<string, { bg: string; fg: string }> = {
    clean: { bg: 'var(--accent-success-light)', fg: 'var(--accent-success)' },
    dirty: { bg: 'var(--accent-danger-light)', fg: 'var(--accent-danger)' },
    in_progress: { bg: 'var(--accent-warning-light)', fg: 'var(--accent-warning)' },
    out_of_order: { bg: 'var(--bg-tertiary)', fg: 'var(--text-tertiary)' },
  };

  const units = board?.units ?? [];
  const counts = useMemo(() => ({
    all: units.length,
    dirty: units.filter((u) => u.cleaning_status === 'dirty' && !u.out_of_order).length,
    in_progress: units.filter((u) => u.cleaning_status === 'in_progress' && !u.out_of_order).length,
    clean: units.filter((u) => u.cleaning_status === 'clean' && !u.out_of_order).length,
    out_of_order: units.filter((u) => u.out_of_order).length,
  }), [units]);
  const visible = units.filter((u) => filter === 'all' ? true : filter === 'out_of_order' ? u.out_of_order : (u.cleaning_status === filter && !u.out_of_order));
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const u of visible) {
      const key = (properties.length > 1 && !propertyId ? `${u.property_name} · ` : '') + (u.unit_type_name || t('Без типу'));
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(u);
    }
    return [...m.entries()];
  }, [visible, properties.length, propertyId, t]);

  const chip = (key: 'all' | Cleaning | 'out_of_order', text: string, n: number) => (
    <button key={key} type="button" className={`filter-chip ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {text} <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-tertiary)' }}>{n}</span>
    </button>
  );

  return (
    <>
      <Header title={t('Прибирання')} onMenuClick={onMenuClick} />
      <div className="app-content">
        {toast && (
          <div style={{ position: 'fixed', top: 80, right: 24, zIndex: 1000, background: 'var(--bg-tooltip)', color: 'var(--text-inverse)', padding: '10px 16px', borderRadius: 'var(--radius-md)', fontSize: 13 }}>{toast}</div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <div className="finance-tabs" style={{ display: 'flex', gap: 4 }}>
            <button type="button" className={`finance-tab ${view === 'board' ? 'active' : ''}`} onClick={() => setView('board')}><Brush size={14} /> {t('Борд номерів')}</button>
            <button type="button" className={`finance-tab ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}><Clock size={14} /> {t('Історія прибирання')}</button>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => { setLoading(true); loadBoard(); if (view === 'history') loadHistory(); }}>
            <RefreshCw size={13} /> {t('Оновити')}
          </button>
        </div>

        {loading ? <LoadingState /> : failed ? <ErrorState retry={() => { setLoading(true); loadBoard(); }} /> : view === 'board' ? (
          <>
            <div className="filter-chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {chip('all', t('Усі номери'), counts.all)}
              {chip('dirty', label.dirty, counts.dirty)}
              {chip('in_progress', label.in_progress, counts.in_progress)}
              {chip('clean', label.clean, counts.clean)}
              {chip('out_of_order', label.out_of_order, counts.out_of_order)}
            </div>
            {units.length === 0 ? (
              <EmptyState title={t('Номерів ще немає')} hint={t('Борд показує номери обʼєкта. Заведіть типи й номери в Налаштуваннях.')}
                action={{ label: t('Налаштування → Номери'), href: '/app/settings/units' }} />
            ) : groups.length === 0 ? (
              <EmptyState compact title={t('Нічого з таким станом')} hint={t('Змініть фільтр стану вгорі.')} />
            ) : groups.map(([group, list]) => (
              <div key={group} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                  {group} <span style={{ fontWeight: 500 }}>{list.filter((u) => u.cleaning_status === 'clean' && !u.out_of_order).length}/{list.length}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
                  {list.map((u) => {
                    const key = u.out_of_order ? 'out_of_order' : (u.cleaning_status as Cleaning);
                    const tn = tone[key];
                    return (
                      <div key={u.id} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, borderColor: tn.fg }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{u.code}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: tn.bg, color: tn.fg }}>
                            {u.out_of_order ? <><Ban size={11} /> {label.out_of_order}</> : label[u.cleaning_status]}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', minHeight: 32 }}>
                          {u.stay ? (
                            <>
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.stay.guest || t('Гість')}</div>
                              <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-tertiary)' }}>
                                {u.departing_today ? <span style={{ color: 'var(--accent-warning)' }}><LogOut size={11} /> {t('виїзд сьогодні')}</span>
                                  : u.arriving_today ? <span style={{ color: 'var(--accent-info)' }}><LogIn size={11} /> {t('заїзд сьогодні')}</span>
                                  : <span>{t('до')} {u.stay.check_out}</span>}
                              </div>
                            </>
                          ) : (
                            <div style={{ color: 'var(--text-tertiary)' }}>{u.out_of_order ? (u.block_reason || t('заблоковано')) : t('вільний')}</div>
                          )}
                        </div>
                        {!u.out_of_order && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            {(['dirty', 'in_progress', 'clean'] as Cleaning[]).map((s) => (
                              <button key={s} type="button" disabled={busy === u.id || u.cleaning_status === s}
                                title={label[s]} onClick={() => change(u, s)}
                                className={`btn btn-sm ${u.cleaning_status === s ? 'btn-primary' : 'btn-secondary'}`}
                                style={{ flex: 1, padding: '4px 0', fontSize: 11 }}>
                                {s === 'dirty' ? <Brush size={12} /> : s === 'in_progress' ? <Clock size={12} /> : <Sparkles size={12} />}
                              </button>
                            ))}
                          </div>
                        )}
                        {!u.out_of_order && (
                          <button type="button" className="btn btn-sm btn-ghost" style={{ fontSize: 11 }} disabled={busy === u.id}
                            onClick={() => change(u, NEXT[u.cleaning_status as Cleaning])}>
                            → {label[NEXT[u.cleaning_status as Cleaning]]}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t('Від')}
                <input className="form-input" type="date" value={hist.from} onChange={(e) => setHist((h) => ({ ...h, from: e.target.value }))} style={{ display: 'block', fontSize: 12 }} />
              </label>
              <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t('До')}
                <input className="form-input" type="date" value={hist.to} onChange={(e) => setHist((h) => ({ ...h, to: e.target.value }))} style={{ display: 'block', fontSize: 12 }} />
              </label>
              <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t('Номер')}
                <select className="form-select" value={hist.unitId} onChange={(e) => setHist((h) => ({ ...h, unitId: e.target.value }))} style={{ display: 'block', fontSize: 12, minWidth: 120 }}>
                  <option value="">{t('Усі номери')}</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                </select>
              </label>
              {/* «Хто» — з тих, хто вже є в журналі за період: окремого списку персоналу борд не тягне. */}
              <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t('Хто')}
                <select className="form-select" value={hist.changedBy} onChange={(e) => setHist((h) => ({ ...h, changedBy: e.target.value }))} style={{ display: 'block', fontSize: 12, minWidth: 140 }}>
                  <option value="">{t('Усі')}</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
            {history === null ? <LoadingState compact /> : history.length === 0 ? (
              <EmptyState compact title={t('Змін прибирання за період немає')} hint={t('Розширте дати або оберіть інший номер.')} />
            ) : (
              <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>{t('Коли')}</th><th>{t('Номер')}</th><th>{t('Було')}</th><th>{t('Стало')}</th><th>{t('Хто')}</th><th>{t('Джерело')}</th><th>{t('Примітка')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((r) => (
                      <tr key={r.id}>
                        <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{String(r.changed_at).replace('T', ' ').slice(0, 16)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.unit_code}{properties.length > 1 && !propertyId ? <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> · {r.property_name}</span> : null}</td>
                        <td>{label[r.from_status] || r.from_status}</td>
                        <td style={{ fontWeight: 600, color: tone[r.to_status]?.fg }}>{label[r.to_status] || r.to_status}</td>
                        <td>{r.changed_by_name || t('Система')}</td>
                        <td style={{ color: 'var(--text-tertiary)' }}>{r.source === 'checkout' ? t('виселення') : t('вручну')}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{r.note || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
