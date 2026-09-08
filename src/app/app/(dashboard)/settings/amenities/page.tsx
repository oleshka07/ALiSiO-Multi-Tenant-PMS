'use client';

/**
 * Зручності: каталог організації і матриця призначення (Блок 5a, 2.2).
 *
 * Два питання, і вони РІЗНІ — тому дві вкладки, як у джерела форми:
 *
 *   «Каталог»     — які слова взагалі є в цього готелю (стартові сорок плюс
 *                   свої). Тут заводять і перейменовують.
 *   «Призначення» — де саме кожне з них є: на обʼєкті і на кожному типі
 *                   номера. Тут ставлять галочки.
 *
 * Область зручності (обʼєкт / номер / обидва) керує тим, у якій колонці
 * галочка взагалі можлива: ліфт у двомісному номері — не помилка оператора,
 * а помилка екрана, який це запропонував.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Save, AlertTriangle, Check, X } from 'lucide-react';
import { useT } from '@core/i18n/client';
import { usePropertyScope } from '@/ui/PropertyScopeContext';

/** Модалка тут своя, як і на сусідніх екранах налаштувань: спільної немає. */
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

interface Amenity {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  scope: 'property' | 'unit_type' | 'both';
}
interface Category { id: string; code: string; name: string; amenities: Amenity[] }
interface UnitType { id: string; name: string; code: string }

export default function AmenitiesPage() {
  const tUi = useT();
  const { propertyId } = usePropertyScope();

  const [tab, setTab] = useState<'catalog' | 'assign'>('catalog');
  const [catalog, setCatalog] = useState<Category[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitType[]>([]);
  const [onProperty, setOnProperty] = useState<Set<string>>(new Set());
  const [onType, setOnType] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ kind: 'amenity', category_id: '', code: '', name: '', scope: 'both' });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [catRes, typesRes] = await Promise.all([
        fetch('/api/amenities'),
        fetch('/api/unit-types'),
      ]);
      const cats: Category[] = catRes.ok ? await catRes.json() : [];
      const types: UnitType[] = typesRes.ok ? await typesRes.json() : [];
      setCatalog(cats);
      setUnitTypes(types);

      if (propertyId) {
        const propRes = await fetch(`/api/properties/${propertyId}/amenities`);
        setOnProperty(new Set(propRes.ok ? (await propRes.json()).map((a: Amenity) => a.id) : []));
      }
      const perType: Record<string, Set<string>> = {};
      for (const ut of types) {
        const res = await fetch(`/api/unit-types/${ut.id}/amenities`);
        perType[ut.id] = new Set(res.ok ? (await res.json()).map((a: Amenity) => a.id) : []);
      }
      setOnType(perType);
    } catch {
      setError(tUi('Не вдалося звʼязатися з сервером'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [propertyId]);

  const allAmenities = useMemo(() => catalog.flatMap((c) => c.amenities), [catalog]);

  const toggleProperty = (a: Amenity) => {
    setOnProperty((prev) => {
      const next = new Set(prev);
      next.has(a.id) ? next.delete(a.id) : next.add(a.id);
      return next;
    });
  };
  const toggleType = (typeId: string, a: Amenity) => {
    setOnType((prev) => {
      const next = { ...prev };
      const set = new Set(next[typeId] ?? []);
      set.has(a.id) ? set.delete(a.id) : set.add(a.id);
      next[typeId] = set;
      return next;
    });
  };
  /** «Позначити все» — лише те, що ця колонка взагалі приймає за областю. */
  const selectAllProperty = (category: Category) => {
    setOnProperty((prev) => {
      const next = new Set(prev);
      for (const a of category.amenities) if (a.scope !== 'unit_type') next.add(a.id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setSaved('');
    try {
      if (propertyId) {
        const res = await fetch(`/api/properties/${propertyId}/amenities`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amenity_ids: [...onProperty] }),
        });
        if (!res.ok) throw new Error('property');
      }
      for (const ut of unitTypes) {
        const res = await fetch(`/api/unit-types/${ut.id}/amenities`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amenity_ids: [...(onType[ut.id] ?? [])] }),
        });
        if (!res.ok) throw new Error(ut.name);
      }
      setSaved(tUi('Збережено'));
      await load();
    } catch {
      setError(tUi('Не вдалося зберегти зручності'));
    } finally {
      setSaving(false);
    }
  };

  const addOne = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/amenities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form.kind === 'category'
          ? { kind: 'category', code: form.code, name: form.name }
          : { category_id: form.category_id, code: form.code, name: form.name, scope: form.scope }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || tUi('Не вдалося додати'));
        return;
      }
      setAddOpen(false);
      setForm({ kind: 'amenity', category_id: '', code: '', name: '', scope: 'both' });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const scopeLabel = (scope: Amenity['scope']) =>
    scope === 'property' ? tUi('обʼєкт') : scope === 'unit_type' ? tUi('номер') : tUi('обʼєкт і номер');

  return (
    <>

      <div className="page-content">
        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-danger-light)', color: 'var(--accent-danger)', marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        {saved && (
          <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-success-light)', color: 'var(--accent-success)', marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={14} /> {saved}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <button className={`btn btn-sm ${tab === 'catalog' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('catalog')}>
            {tUi('Каталог')}
          </button>
          <button className={`btn btn-sm ${tab === 'assign' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('assign')}>
            {tUi('Призначення')}
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {allAmenities.length} {tUi('зручностей')}
          </span>
          <button className="btn btn-sm btn-secondary" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> {tUi('Додати')}
          </button>
          {tab === 'assign' && (
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {tUi('Зберегти')}
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <Loader2 size={20} className="spin" /> {tUi('Завантаження...')}
          </div>
        ) : tab === 'catalog' ? (
          catalog.map((c) => (
            <div key={c.id} className="card" style={{ marginBottom: 12 }}>
              <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span className="badge badge-primary" style={{ fontSize: 10 }}>{c.amenities.length}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12 }}>
                {c.amenities.map((a) => (
                  <span key={a.id} style={{
                    padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12,
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                  }}>
                    {a.name}
                    <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>· {scopeLabel(a.scope)}</span>
                  </span>
                ))}
                {c.amenities.length === 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{tUi('Порожньо')}</span>
                )}
              </div>
            </div>
          ))
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>{tUi('Зручність')}</th>
                  <th style={{ textAlign: 'center' }}>{tUi('Обʼєкт')}</th>
                  {unitTypes.map((ut) => (
                    <th key={ut.id} style={{ textAlign: 'center' }}>{ut.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catalog.map((c) => (
                  <>
                    <tr key={c.id} style={{ background: 'var(--bg-secondary)' }}>
                      <td colSpan={2 + unitTypes.length} style={{ fontWeight: 600 }}>
                        {c.name}
                        <button
                          className="btn btn-sm btn-ghost"
                          style={{ marginLeft: 8, fontSize: 11 }}
                          onClick={() => selectAllProperty(c)}
                        >{tUi('Позначити все на обʼєкті')}</button>
                      </td>
                    </tr>
                    {c.amenities.map((a) => (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td style={{ textAlign: 'center' }}>
                          {/* Область: клітинка, у якій зручність неможлива, не
                              показує порожньої галочки — вона показує риску,
                              інакше оператор ставить її і не розуміє відмови. */}
                          {a.scope === 'unit_type' ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : (
                            <input
                              type="checkbox"
                              checked={onProperty.has(a.id)}
                              onChange={() => toggleProperty(a)}
                            />
                          )}
                        </td>
                        {unitTypes.map((ut) => (
                          <td key={ut.id} style={{ textAlign: 'center' }}>
                            {a.scope === 'property' ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : (
                              <input
                                type="checkbox"
                                checked={(onType[ut.id] ?? new Set()).has(a.id)}
                                onChange={() => toggleType(ut.id, a)}
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
            {unitTypes.length === 0 && (
              <div style={{ padding: 16, fontSize: 13, color: 'var(--text-tertiary)' }}>
                {tUi('Типів номерів ще немає — заведіть їх у «Типи номерів і номери»')}
              </div>
            )}
          </div>
        )}
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={tUi('Додати зручність або розділ')}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setAddOpen(false)}>{tUi('Скасувати')}</button>
            <button className="btn btn-primary" onClick={addOne} disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {tUi('Створити')}
            </button>
          </>
        }
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{tUi('Що додаємо')}</label>
            <select className="form-select" value={form.kind} onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value }))}>
              <option value="amenity">{tUi('Зручність')}</option>
              <option value="category">{tUi('Розділ каталогу')}</option>
            </select>
          </div>
        </div>
        {form.kind === 'amenity' && (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Розділ')}</label>
              <select className="form-select" value={form.category_id} onChange={(e) => setForm((p) => ({ ...p, category_id: e.target.value }))}>
                <option value="">{tUi('Оберіть розділ')}</option>
                {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Де буває')}</label>
              <select className="form-select" value={form.scope} onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value }))}>
                <option value="both">{tUi('обʼєкт і номер')}</option>
                <option value="property">{tUi('обʼєкт')}</option>
                <option value="unit_type">{tUi('номер')}</option>
              </select>
            </div>
          </div>
        )}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{tUi('Назва')}</label>
            <input className="form-input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">{tUi('Код')}</label>
            <input className="form-input" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} placeholder="ski_room" />
            <div className="form-hint">{tUi('Стабільний ключ для каналів і сайту. Назву можна міняти, код — ні.')}</div>
          </div>
        </div>
      </Modal>
    </>
  );
}
