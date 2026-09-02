'use client';

/**
 * Цінова матриця: «категорія × заселеність × сезон», і знижки за довжину.
 *
 * Головне правило, з якого росте весь екран:
 *
 *   ЗАСЕЛЕНІСТЬ МІНЯЄ ЦІНУ, А НЕ КАТЕГОРІЮ.
 *
 * Один і той самий двомісний номер продається одному дорослому за одну ціну,
 * двом — за іншу. Це та сама категорія, той самий номер, те саме ліжко. Тому
 * таблиця має рядок на категорію і стовпчик на кількість ДОРОСЛИХ (рішення
 * Ц12: діти йдуть окремою надбавкою тарифу), а не окрему категорію
 * «одномісний»: інакше готель веде два списки номерів на один набір кімнат, і
 * доступність ламається на першому ж бронюванні.
 *
 * Сезон — це не інша таблиця, а вужчий рядок поверх базової ціни. Тому екран
 * перемикається між «базовими» (без дат) і кожним заведеним періодом, а не
 * змушує переписувати ціни двічі на рік.
 *
 * Числа в прикладах під полями — з інтерфейсу, не з коду: жодної ціни, жодної
 * назви сезону і жодної знижки тут не зашито.
 */

import { useT } from '@core/i18n/client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { Plus, Trash2, X, Loader2, ArrowLeft, Users, CalendarRange, Calculator } from 'lucide-react';
import Link from 'next/link';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Property { id: string; name: string }
interface Price {
  id: string;
  unit_type_id: string | null;
  persons: number;
  price_gross: number;
  valid_from: string | null;
  valid_to: string | null;
  label: string | null;
}

interface Tier {
  id: string;
  unit_type_id: string | null;
  min_nights: number;
  adjustment_gross: number;
  persons: number | null;
  label: string | null;
}

interface UnitType {
  id: string;
  property_id?: string | null;
  name: string;
  /** Скільки людей категорія вміщає — так це поле зветься в /api/unit-types. */
  max_occupancy?: number | null;
}

/** Один період — набір рядків з однаковими датами. */
interface Season {
  key: string;
  from: string | null;
  to: string | null;
  label: string | null;
}

const seasonKey = (from: string | null, to: string | null) => `${from || ''}..${to || ''}`;

/** Чи це той єдиний період, що не має жодної дати. */
const isBase = (s: { from: string | null; to: string | null }) => !s.from && !s.to;

/**
 * Як період зветься у списку вкладок.
 *
 * Вікно, відкрите з одного боку, — це теж період, а не базова ціна. «По
 * 31.12.2026» має кінець, «від 01.03.2027» має початок, і прайс-лист готелю
 * пишеться саме так. Умова тут питала тільки про початок, тому обидва такі
 * вікна підписувались «Базові ціни»: власник бачив дві однакові вкладки, з
 * яких перша — справді бездатна — виглядала майже порожньою. Друга половина
 * тієї ж помилки: у вікна без кінця в підпис підставлявся рядок «null».
 */
function periodTitle(s: Season, t: (text: string) => string): string {
  if (isBase(s)) return t('Базові ціни');
  const dates = s.from && s.to
    ? `${s.from} — ${s.to}`
    : s.from ? `${t('від')} ${s.from}` : `${t('по')} ${s.to}`;
  return s.label ? `${s.label}: ${dates}` : dates;
}

function Modal({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export default function PricingMatrixPage() {
  const t = useT();
  const onMenuClick = useMobileMenu();

  const [prices, setPrices] = useState<Price[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [types, setTypes] = useState<UnitType[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);

  const [season, setSeason] = useState<string>(seasonKey(null, null));
  const [seasonModal, setSeasonModal] = useState(false);
  const [seasonForm, setSeasonForm] = useState({ valid_from: '', valid_to: '', label: '' });

  const [tierModal, setTierModal] = useState(false);
  const [tierForm, setTierForm] = useState({ unit_type_id: '', min_nights: '', adjustment_gross: '', persons: '', label: '' });

  const [quoteForm, setQuoteForm] = useState({ unit_type_id: '', check_in: '', nights: '3', adults: '2', children: '0', child_extra_gross: '' });
  const [quote, setQuote] = useState<any>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  /**
   * Обʼєкт — явно. 02.09.2026: в організації з двома обʼєктами цей екран не
   * міг ні прочитати, ні записати жодної ціни — без `property_id`
   * `requirePropertyId` відмовляє, і відмова правильна (AGENTS, інваріант 1):
   * вгадати обʼєкт означало б покласти ціну не тому готелю. Спершу список
   * обʼєктів, потім матриця обраного.
   */
  const fetchAll = useCallback(async (pid: string) => {
    setLoading(true);
    try {
      if (!pid) {
        const res = await fetch('/api/properties');
        const list = await res.json();
        const arr: Property[] = Array.isArray(list) ? list : (list?.properties ?? []);
        setProperties(arr);
        if (arr[0]) setPropertyId(arr[0].id);
        return;
      }
      const [m, u] = await Promise.all([
        fetch(`/api/pricing/occupancy?property_id=${encodeURIComponent(pid)}`).then((x) => x.json()),
        fetch('/api/unit-types').then((x) => x.json()),
      ]);
      setPrices(m.prices || []);
      setTiers(m.tiers || []);
      // Ендпоїнт віддає або масив, або {unitTypes}. Обидва бачив на різних
      // екранах — тут не місце зʼясовувати, який із них «правильний».
      const all: UnitType[] = Array.isArray(u) ? u : (u.unitTypes || u.unit_types || []);
      // Лише типи ЦЬОГО обʼєкта: матриця ключується типом, і рядок чужого
      // обʼєкта в цій таблиці — це ціна, якої не запишеш і не прочитаєш.
      setTypes(all.filter((ut) => !ut.property_id || ut.property_id === pid));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(propertyId); }, [propertyId, fetchAll]);

  // ── Періоди: базовий завжди є, решта — з самих рядків ─────────────────────
  const seasons: Season[] = useMemo(() => {
    const map = new Map<string, Season>();
    map.set(seasonKey(null, null), { key: seasonKey(null, null), from: null, to: null, label: null });
    for (const p of prices) {
      if (!p.valid_from && !p.valid_to) continue;
      const key = seasonKey(p.valid_from, p.valid_to);
      if (!map.has(key)) map.set(key, { key, from: p.valid_from, to: p.valid_to, label: p.label });
    }
    // Базові — завжди перші; решта за початком, а вікно без початку — за
    // кінцем. Без цього «по 31.12.2026» і базові сортуються за одним і тим
    // самим порожнім рядком і міняються місцями від запиту до запиту.
    return [...map.values()].sort((a, b) => {
      if (isBase(a) !== isBase(b)) return isBase(a) ? -1 : 1;
      return (a.from || a.to || '').localeCompare(b.from || b.to || '');
    });
  }, [prices]);

  const current = seasons.find((s) => s.key === season) ?? seasons[0];

  // Скільки стовпчиків показувати: до найбільшої місткості серед категорій,
  // але щонайменше два — інакше з одномісної місткості екран стає одним полем.
  const maxPersons = useMemo(() => {
    const fromTypes = types.reduce((m, u) => Math.max(m, Number(u.max_occupancy) || 0), 0);
    const fromPrices = prices.reduce((m, p) => Math.max(m, p.persons), 0);
    return Math.min(Math.max(fromTypes, fromPrices, 2), 10);
  }, [types, prices]);

  const cell = (unitTypeId: string, persons: number): Price | undefined =>
    prices.find((p) => p.unit_type_id === unitTypeId
      && p.persons === persons
      && seasonKey(p.valid_from, p.valid_to) === current.key);

  /**
   * Одна комірка: збереження — це або нова ціна, або зміна наявної, або
   * прибирання. Порожнє поле означає «ціни немає», і це не те саме, що нуль:
   * ніч без ціни система назве в `missing`, а не продасть за 0.
   */
  const saveCell = async (unitTypeId: string, persons: number, raw: string) => {
    const existing = cell(unitTypeId, persons);
    const text = raw.trim().replace(',', '.');

    if (text === '') {
      if (!existing) return;
      const res = await fetch(`/api/pricing/occupancy/${existing.id}`, { method: 'DELETE' });
      if (!res.ok) showToast(`❌ ${t((await res.json()).error)}`); else fetchAll(propertyId);
      return;
    }

    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) { showToast(`❌ ${t('Ціна має бути числом')}`); return; }
    if (existing && value === Number(existing.price_gross)) return;

    const res = existing
      ? await fetch(`/api/pricing/occupancy/${existing.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_gross: value, label: existing.label }),
      })
      : await fetch('/api/pricing/occupancy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId,
          unit_type_id: unitTypeId, persons, price_gross: value,
          valid_from: current.from, valid_to: current.to, label: current.label,
        }),
      });
    if (!res.ok) showToast(`❌ ${t((await res.json()).error)}`); else fetchAll(propertyId);
  };

  const addSeason = () => {
    // Одна дата — теж період: «по 31.12.2026» діє з початку часів до кінця
    // року, «від 01.03.2027» — і далі. Вимога обох дат забороняла завести з
    // екрана рівно ті вікна, якими прайс-лист готелю й написаний.
    const from = seasonForm.valid_from || null;
    const to = seasonForm.valid_to || null;
    if (!from && !to) { showToast(`❌ ${t('Потрібна хоча б одна дата')}`); return; }
    if (from && to && to < from) { showToast(`❌ ${t('Кінець періоду раніший за початок')}`); return; }
    // Період існує з моменту, коли в ньому є перша ціна. Тому тут лише
    // перемикаємо екран — рядки зʼявляться, щойно власник заповнить комірки.
    const key = seasonKey(from, to);
    setPrices((prev) => [...prev, {
      id: `draft:${key}`, unit_type_id: null, persons: 0, price_gross: 0,
      valid_from: from, valid_to: to, label: seasonForm.label || null,
    }]);
    setSeason(key);
    setSeasonModal(false);
  };

  const saveTier = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/pricing/los-tiers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId,
          unit_type_id: tierForm.unit_type_id || null,
          min_nights: Number(tierForm.min_nights),
          adjustment_gross: Number(String(tierForm.adjustment_gross).replace(',', '.')),
          persons: tierForm.persons === '' ? null : Number(tierForm.persons),
          label: tierForm.label || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${t(data.error)}`); return; }
      setTierModal(false);
      fetchAll(propertyId);
    } catch (e: any) { showToast(`❌ ${t(e.message)}`); } finally { setSaving(false); }
  };

  const removeTier = async (tier: Tier) => {
    if (!window.confirm(t('Прибрати цю знижку за довжину?'))) return;
    const res = await fetch(`/api/pricing/los-tiers/${tier.id}`, { method: 'DELETE' });
    if (!res.ok) showToast(`❌ ${t((await res.json()).error)}`); else fetchAll(propertyId);
  };

  const runQuote = async () => {
    const p = new URLSearchParams({
      property_id: propertyId,
      unit_type_id: quoteForm.unit_type_id, check_in: quoteForm.check_in,
      nights: quoteForm.nights, adults: quoteForm.adults,
      children: quoteForm.children || '0',
      // Ціна дитини тут приміряється, а не береться з тарифу: сенс екрана —
      // побачити, у що виллється число, ДО того, як його записати.
      ...(quoteForm.child_extra_gross === '' ? {} : { child_extra_gross: quoteForm.child_extra_gross }),
    });
    const res = await fetch(`/api/pricing/occupancy-quote?${p}`);
    const data = await res.json();
    if (!res.ok) { showToast(`❌ ${t(data.error)}`); setQuote(null); return; }
    setQuote(data);
  };

  const typeName = (id: string | null) => types.find((u) => u.id === id)?.name || t('Усі категорії');

  return (
    <>
      <Header title={t('Ціни за заселеністю')} onMenuClick={onMenuClick} />
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
            <h2 className="page-title">{t('Ціни за заселеністю')}</h2>
            <div className="page-subtitle">{t('Скільки коштує ніч залежно від кількості гостей — і що знімає довше проживання')}</div>
          </div>
          {properties.length > 1 && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-tertiary)' }}>
              {t('Обʼєкт')}
              <select className="form-select" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 64 }}>
            <Loader2 size={24} className="animate-pulse" style={{ display: 'inline-block' }} /> {t('Завантаження...')}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 16, maxWidth: '80ch' }}>
              {t('Заселеність міняє ціну, а не категорію: той самий номер для одного дорослого і для двох — це один рядок номерного фонду і дві ціни. Стовпчики рахують ДОРОСЛИХ: ціна дитини задається окремо на тарифі, тож «ціна на 4» тут означає чотирьох дорослих, а не сімʼю. Порожня комірка означає, що ціни немає: такі ночі система назве окремо, а не продасть за нуль.')}
            </div>

            {/* ── Періоди ────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <CalendarRange size={16} style={{ color: 'var(--text-tertiary)' }} />
              {seasons.map((s) => (
                <button
                  key={s.key}
                  className={`btn btn-sm ${s.key === current.key ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setSeason(s.key)}
                >
                  {t(periodTitle(s, t))}
                </button>
              ))}
              <button className="btn btn-sm btn-ghost" onClick={() => { setSeasonForm({ valid_from: '', valid_to: '', label: '' }); setSeasonModal(true); }}>
                <Plus size={14} /> {t('Період')}
              </button>
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 12, maxWidth: '80ch' }}>
              {isBase(current)
                ? t('Базові ціни діють завжди, поки їх не перекриє період.')
                : t('Ціни цього періоду діють поверх базових. Поза ним знову діють базові — базові переписувати не треба.')}
            </div>

            {/* ── Матриця ────────────────────────────────────────────────── */}
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Категорія')}</th>
                    {Array.from({ length: maxPersons }, (_, i) => (
                      <th key={i} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Users size={12} style={{ verticalAlign: -1 }} /> {i + 1}
                        <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> {t('дор.')}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {types.length === 0 && (
                    <tr><td colSpan={maxPersons + 1} style={{ color: 'var(--text-tertiary)', padding: 20 }}>
                      {t('Спочатку заведіть категорії номерів.')}
                    </td></tr>
                  )}
                  {types.map((u) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {u.name}
                        {u.max_occupancy ? (
                          <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, fontSize: 12 }}>
                            {' '}· {t('до')} {u.max_occupancy}
                          </span>
                        ) : null}
                      </td>
                      {Array.from({ length: maxPersons }, (_, i) => {
                        const persons = i + 1;
                        const existing = cell(u.id, persons);
                        // Понад місткість ціни бути не може — комірку не
                        // показуємо взагалі, щоб її не заповнили помилково.
                        const overCapacity = !!u.max_occupancy && persons > Number(u.max_occupancy);
                        return (
                          <td key={persons} style={{ textAlign: 'right', padding: 4 }}>
                            {overCapacity ? (
                              <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                            ) : (
                              <input
                                className="input"
                                inputMode="decimal"
                                defaultValue={existing ? String(existing.price_gross) : ''}
                                key={`${current.key}:${u.id}:${persons}:${existing?.price_gross ?? ''}`}
                                onBlur={(e) => saveCell(u.id, persons, e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                style={{ width: 88, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {types.length > 0 && !prices.some((p) => !p.id.startsWith('draft:')
              && seasonKey(p.valid_from, p.valid_to) === current.key) && (
              <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 8, maxWidth: '80ch' }}>
                {t('У цьому періоді ще немає жодної ціни — порожня таблиця тут означає саме це, а не «цін немає взагалі». Ціни інших періодів дивіться на вкладках вище.')}
              </div>
            )}

            {/* ── Знижки за довжину ──────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '28px 0 12px' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Знижки за довжину проживання')}</span>
              <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }}
                onClick={() => { setTierForm({ unit_type_id: '', min_nights: '', adjustment_gross: '', persons: '', label: '' }); setTierModal(true); }}>
                <Plus size={14} /> {t('Додати')}
              </button>
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 12, maxWidth: '80ch' }}>
              {t('Змінюють ціну за ніч, коли проживання досягає порогу. Якщо порогів кілька — діє найвищий досягнутий. Відʼємне число знімає, додатне додає.')}
            </div>

            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Від скількох ночей')}</th>
                    <th>{t('Категорія')}</th>
                    <th>{t('Заселеність')}</th>
                    <th style={{ textAlign: 'right' }}>{t('За ніч')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.length === 0 && (
                    <tr><td colSpan={5} style={{ color: 'var(--text-tertiary)', padding: 20 }}>
                      {t('Знижок за довжину немає — ціна за ніч однакова для будь-якого проживання.')}
                    </td></tr>
                  )}
                  {tiers.map((tier) => (
                    <tr key={tier.id}>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{tier.min_nights}</td>
                      <td>{typeName(tier.unit_type_id)}</td>
                      <td>{tier.persons == null ? t('будь-яка') : tier.persons}</td>
                      <td style={{
                        textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                        color: Number(tier.adjustment_gross) < 0 ? 'var(--accent-success)' : undefined,
                      }}>
                        {Number(tier.adjustment_gross) > 0 ? '+' : ''}{tier.adjustment_gross}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-danger)' }} onClick={() => removeTier(tier)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Перевірка ──────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '28px 0 12px' }}>
              <Calculator size={16} style={{ color: 'var(--text-tertiary)' }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Перевірити на прикладі')}</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 12, maxWidth: '80ch' }}>
              {t('Рахує тим самим кодом, що й бронювання. Якщо на якусь ніч ціни немає, вона буде названа окремо.')}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">{t('Категорія')}</label>
                <select className="input" value={quoteForm.unit_type_id}
                  onChange={(e) => setQuoteForm({ ...quoteForm, unit_type_id: e.target.value })}>
                  <option value="">—</option>
                  {types.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">{t('Заїзд')}</label>
                <input className="input" type="date" value={quoteForm.check_in}
                  onChange={(e) => setQuoteForm({ ...quoteForm, check_in: e.target.value })} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">{t('Ночей')}</label>
                <input className="input" type="number" min={1} style={{ width: 90 }} value={quoteForm.nights}
                  onChange={(e) => setQuoteForm({ ...quoteForm, nights: e.target.value })} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">{t('Дорослих')}</label>
                <input className="input" type="number" min={1} style={{ width: 90 }} value={quoteForm.adults}
                  onChange={(e) => setQuoteForm({ ...quoteForm, adults: e.target.value })} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">{t('Дітей')}</label>
                <input className="input" type="number" min={0} style={{ width: 90 }} value={quoteForm.children}
                  onChange={(e) => setQuoteForm({ ...quoteForm, children: e.target.value })} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">{t('Ціна дитини за ніч')}</label>
                <input className="input" type="number" min={0} style={{ width: 130 }}
                  placeholder={t('не названо')} value={quoteForm.child_extra_gross}
                  onChange={(e) => setQuoteForm({ ...quoteForm, child_extra_gross: e.target.value })} />
              </div>
              <button className="btn btn-secondary" onClick={runQuote}>{t('Порахувати')}</button>
            </div>

            {quote && (
              <div className="table-wrapper" style={{ marginBottom: 24 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('Ніч')}</th>
                      <th style={{ textAlign: 'right' }}>{t('Базова')}</th>
                      <th style={{ textAlign: 'right' }}>{t('Знижка')}</th>
                      <th style={{ textAlign: 'right' }}>{t('До сплати')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.nights?.map((n: any) => (
                      <tr key={n.date}>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{n.date}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n.base}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: n.adjustment ? 'var(--accent-success)' : undefined }}>
                          {n.adjustment || ''}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{n.price}</td>
                      </tr>
                    ))}
                    {quote.missing?.length > 0 && (
                      <tr>
                        <td colSpan={4} style={{ color: 'var(--accent-danger)' }}>
                          {t('Немає ціни на')}: {quote.missing.join(', ')}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>{t('Разом')}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{quote.total}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <Modal
          open={seasonModal}
          onClose={() => setSeasonModal(false)}
          title={t('Новий період')}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setSeasonModal(false)}>{t('Скасувати')}</button>
            <button className="btn btn-primary" onClick={addSeason}>{t('Далі')}</button>
          </>}
        >
          <div className="form-group">
            <label className="form-label">{t('Назва')}</label>
            <input className="input" value={seasonForm.label}
              onChange={(e) => setSeasonForm({ ...seasonForm, label: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">{t('З')}</label>
              <input className="input" type="date" value={seasonForm.valid_from}
                onChange={(e) => setSeasonForm({ ...seasonForm, valid_from: e.target.value })} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">{t('До')}</label>
              <input className="input" type="date" value={seasonForm.valid_to}
                onChange={(e) => setSeasonForm({ ...seasonForm, valid_to: e.target.value })} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {t('Дати включно. Одну з них можна лишити порожньою: без початку період діє від початку часів, без кінця — безстроково. Період зʼявиться в списку, щойно в ньому буде перша ціна.')}
          </div>
        </Modal>

        <Modal
          open={tierModal}
          onClose={() => setTierModal(false)}
          title={t('Знижка за довжину проживання')}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setTierModal(false)}>{t('Скасувати')}</button>
            <button className="btn btn-primary" onClick={saveTier} disabled={saving}>{t('Зберегти')}</button>
          </>}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">{t('Від скількох ночей')}</label>
              <input className="input" type="number" min={2} value={tierForm.min_nights}
                onChange={(e) => setTierForm({ ...tierForm, min_nights: e.target.value })} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">{t('Зміна ціни за ніч')}</label>
              <input className="input" inputMode="decimal" value={tierForm.adjustment_gross}
                onChange={(e) => setTierForm({ ...tierForm, adjustment_gross: e.target.value })} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
            {t('Відʼємне число знімає з ціни ночі, додатне — додає.')}
          </div>
          <div className="form-group">
            <label className="form-label">{t('Категорія')}</label>
            <select className="input" value={tierForm.unit_type_id}
              onChange={(e) => setTierForm({ ...tierForm, unit_type_id: e.target.value })}>
              <option value="">{t('Усі категорії')}</option>
              {types.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Заселеність (дорослих)')}</label>
            <input className="input" type="number" min={1} placeholder={t('будь-яка')} value={tierForm.persons}
              onChange={(e) => setTierForm({ ...tierForm, persons: e.target.value })} />
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
              {t('Порожньо — знижка діє за будь-якої кількості гостей.')}
            </div>
          </div>
        </Modal>
      </div>
    </>
  );
}
