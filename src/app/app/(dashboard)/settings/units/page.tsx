'use client';

import { useT, usePlural } from '@core/i18n/client';
import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import PropertyRequired from '@/components/layout/PropertyRequired';
import { ImageUploadField } from '@/components/ui/ImageUploadField';
import {
  ChevronRight,
  Plus,
  Edit3,
  Trash2,
  Tent,
  Building2,
  TreePine,
  BedDouble,
  X,
  Save,
  Home,
  Loader2,
  AlertTriangle,
  Key,
  Camera,
} from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Types ────────────────────────────────────────────────
interface UnitFromAPI {
  id: string;
  name: string;
  code: string;
  beds: number;
  zone?: string;
  room_status: string;
  cleaning_status: string;
  sort_order: number;
  is_active: number;
  category_id: string;
  category_name: string;
  category_type: string;
  category_icon?: string;
  category_color?: string;
  unit_type_id: string;
  unit_type_name: string;
  unit_type_code: string;
  max_adults: number;
  base_occupancy: number;
  lock_code?: string;
  entry_photo_url?: string;
}

interface UnitTypeFromAPI {
  id: string;
  name: string;
  code: string;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  base_occupancy: number;
  beds_single: number;
  beds_double: number;
  sort_order: number;
  category_id: string;
  category_name: string;
  category_type: string;
  unit_count: number;
}

interface CategoryFromAPI {
  id: string;
  name: string;
  type: string;
  sort_order: number;
  icon?: string;
  color?: string;
}

// ─── Display grouping ────────────────────────────────────
interface DisplayGroup {
  categoryType: string;
  categoryName: string;
  categoryId: string;
  categoryIcon?: string;
  subGroups: DisplaySubGroup[];
}

interface DisplaySubGroup {
  key: string;
  label: string;
  unitTypeId?: string;
  units: UnitFromAPI[];
}

const categoryIcons: Record<string, React.ReactNode> = {
  glamping: <Tent size={18} />,
  resort: <Building2 size={18} />,
  camping: <TreePine size={18} />,
};

const categoryBadge: Record<string, string> = {
  glamping: 'badge-glamping',
  resort: 'badge-resort',
  camping: 'badge-camping',
};

// ─── Modal Component ──────────────────────────────────────
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

function Modal({ open, onClose, title, children, footer }: ModalProps) {
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

// ─── Main Component ───────────────────────────────────────
export default function SettingsUnitsPage() {
  const pluralUi = usePlural();
  const tUi = useT();
  const onMenuClick = useMobileMenu();

  // Data from API
  const [units, setUnits] = useState<UnitFromAPI[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitTypeFromAPI[]>([]);
  const [categories, setCategories] = useState<CategoryFromAPI[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [collapsedSub, setCollapsedSub] = useState<Record<string, boolean>>({});

  // Edit Unit modal
  const [editUnitModal, setEditUnitModal] = useState(false);
  // Rooms come in ranges, not one by one. A 31-room hotel entered through the
  // single-room form is 31 modals; the API has taken `prefix/from/to` all along
  // and no screen ever called it.
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    category_id: '', unit_type_id: '',
    prefix: '', from: 1, to: 10, beds: 2, zone: '',
  });
  const [bulkResult, setBulkResult] = useState('');
  const [editingUnit, setEditingUnit] = useState<UnitFromAPI | null>(null);
  const [unitForm, setUnitForm] = useState({ name: '', code: '', beds: 0, zone: '', unit_type_id: '', room_status: 'available', cleaning_status: 'clean', lock_code: '', entry_photo_url: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Edit Unit Type modal
  const [editTypeModal, setEditTypeModal] = useState(false);
  const [editingType, setEditingType] = useState<UnitTypeFromAPI | null>(null);
  const [typeForm, setTypeForm] = useState({ name: '', code: '', category_id: '', max_adults: 2, max_children: 2, max_occupancy: 4, base_occupancy: 2, beds_single: 0, beds_double: 1, sort_order: 0, bookable_online: true, breakfast_included: '' as '' | '1' | '0' });

  // Delete modals
  const [deleteUnitModal, setDeleteUnitModal] = useState(false);
  const [deleteUnitTarget, setDeleteUnitTarget] = useState<UnitFromAPI | null>(null);
  const [deleteTypeModal, setDeleteTypeModal] = useState(false);
  const [deleteTypeTarget, setDeleteTypeTarget] = useState<UnitTypeFromAPI | null>(null);
  const [deleteError, setDeleteError] = useState('');

  // ─── Fetch data from API ──────────────────────────────────
  // Обʼєкт — з області в шапці (check-property-scope). Створення нижче
  // називає його явно: без `property_id` сервер з двома обʼєктами
  // відмовляє («say which»), а не вгадує — і цей екран у готелю з двома
  // не міг створити жодного номера.
  const { propertyId } = usePropertyScope();
  const fetchData = useCallback(async () => {
    if (!propertyId) { setUnits([]); setUnitTypes([]); setCategories([]); setLoading(false); return; }
    try {
      const [unitsRes, typesRes, catsRes] = await Promise.all([
        fetch('/api/units'),
        fetch('/api/unit-types'),
        fetch('/api/categories'),
      ]);
      const [unitsData, typesData, catsData] = await Promise.all([
        unitsRes.json(),
        typesRes.json(),
        catsRes.json(),
      ]);
      // Списки організаційні; на екрані — лише рядки обраного обʼєкта.
      const own = (rows: unknown) => (Array.isArray(rows) ? rows.filter((r) => r.property_id === propertyId) : []);
      setUnits(own(unitsData));
      setUnitTypes(own(typesData));
      setCategories(own(catsData));
    } catch (e) {
      console.error('Failed to load data:', e);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Build display groups ─────────────────────────────────
  const displayGroups: DisplayGroup[] = [];
  // The hotel's own order, from the column it already has. This sorted by a
  // fixed list of three words, so a category typed anything else landed at
  // index -1 and jumped to the front — and two categories sharing a type were
  // indistinguishable here for the same reason they merged in the calendar.
  const sortedCats = [...categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  for (const cat of sortedCats) {
    const catUnits = units.filter(u => u.category_id === cat.id);
    const catTypes = unitTypes.filter(ut => ut.category_id === cat.id);

    const subGroups: DisplaySubGroup[] = [];

    // Групування — за типом номера, одним способом для всіх готелів.
    //
    // Тут був другий спосіб — за будовою, якщо в категорії є будови. Будов
    // більше немає: окрема таблиця з CRUD і власним типом iCal-каналу
    // існувала заради одного клієнта, а корпус чи крило готель називає
    // текстом у `units.zone`, який друкує сам.
    {
      const typeMap = new Map<string, UnitFromAPI[]>();
      for (const u of catUnits) {
        const key = u.unit_type_id;
        if (!typeMap.has(key)) typeMap.set(key, []);
        typeMap.get(key)!.push(u);
      }
      for (const [tKey, tUnits] of typeMap) {
        const ut = catTypes.find(t => t.id === tKey);
        subGroups.push({
          key: `type_${tKey}`,
          label: ut ? ut.name : 'Невідомий тип',
          unitTypeId: tKey,
          units: tUnits.sort((a, b) => a.sort_order - b.sort_order),
        });
      }
    }

    displayGroups.push({
      categoryType: cat.type,
      categoryName: cat.name,
      categoryId: cat.id,
      categoryIcon: cat.icon,
      subGroups,
    });
  }

  const toggleGroup = (key: string) => setCollapsed((p) => ({ ...p, [key]: !p[key] }));
  const toggleSub = (key: string) => setCollapsedSub((p) => ({ ...p, [key]: !p[key] }));

  // ─── Unit CRUD ────────────────────────────────────────────
  const openEditUnit = (unit: UnitFromAPI) => {
    setEditingUnit(unit);
    setUnitForm({
      name: unit.name,
      code: unit.code,
      beds: unit.beds,
      zone: unit.zone || '',
      unit_type_id: unit.unit_type_id,
      room_status: unit.room_status,
      cleaning_status: unit.cleaning_status,
      lock_code: unit.lock_code || '',
      entry_photo_url: unit.entry_photo_url || '',
    });
    setError('');
    setEditUnitModal(true);
  };

  const openBulk = () => {
    setBulkForm({
      category_id: categories[0]?.id || '',
      unit_type_id: '',
      prefix: '', from: 1, to: 10, beds: 2, zone: '',
    });
    setBulkResult('');
    setError('');
    setBulkModal(true);
  };

  const handleBulkCreate = async () => {
    if (!bulkForm.category_id || !bulkForm.unit_type_id) {
      setError(tUi('Оберіть категорію і тип номера'));
      return;
    }
    if (bulkForm.to < bulkForm.from) {
      setError(tUi('Кінець діапазону менший за початок'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bulk: true,
          property_id: propertyId,
          category_id: bulkForm.category_id,
          unit_type_id: bulkForm.unit_type_id,
          prefix: bulkForm.prefix,
          from: Number(bulkForm.from),
          to: Number(bulkForm.to),
          beds: Number(bulkForm.beds),
          zone: bulkForm.zone || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || tUi('Помилка збереження'));
        return;
      }
      setBulkResult(`${tUi('Створено:')} ${data.created}`);
      fetchData();
    } catch (e: any) {
      setError(e.message || tUi('Помилка мережі'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveUnit = async () => {
    if (!unitForm.name || !unitForm.code) {
      setError(tUi('Назва і код обов\'язкові'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const url = editingUnit ? `/api/units/${editingUnit.id}` : '/api/units';
      const method = editingUnit ? 'PATCH' : 'POST';
      const body: any = {
        name: unitForm.name,
        code: unitForm.code,
        beds: unitForm.beds,
        zone: unitForm.zone || null,
        unit_type_id: unitForm.unit_type_id,
        room_status: unitForm.room_status,
        cleaning_status: unitForm.cleaning_status,
        lock_code: unitForm.lock_code || null,
        entry_photo_url: unitForm.entry_photo_url || null,
      };
      if (!editingUnit) {
        // For creating, need property_id and category_id
        const ut = unitTypes.find(t => t.id === unitForm.unit_type_id);
        // Обʼєкт — обраний у шапці. Тут колись стояло 'prop_main_001' (засів
        // першого клієнта), і кожен інший готель діставав «Property not found».
        body.property_id = propertyId;
        body.category_id = ut?.category_id || '';
      }

      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Помилка збереження');
        return;
      }
      setEditUnitModal(false);
      fetchData();
    } catch (e: any) {
      setError(e.message || 'Помилка мережі');
    } finally {
      setSaving(false);
    }
  };

  const openDeleteUnit = (unit: UnitFromAPI) => {
    setDeleteUnitTarget(unit);
    setDeleteError('');
    setDeleteUnitModal(true);
  };

  const handleDeleteUnit = async () => {
    if (!deleteUnitTarget) return;
    setSaving(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/units/${deleteUnitTarget.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error || 'Помилка видалення');
        setSaving(false);
        return;
      }
      setDeleteUnitModal(false);
      fetchData();
    } catch (e: any) {
      setDeleteError(e.message || 'Помилка мережі');
    } finally {
      setSaving(false);
    }
  };

  // ─── Unit Type CRUD ───────────────────────────────────────
  const openEditType = (ut: UnitTypeFromAPI) => {
    setEditingType(ut);
    setTypeForm({
      name: ut.name,
      code: ut.code,
      category_id: ut.category_id,
      max_adults: ut.max_adults,
      max_children: ut.max_children,
      max_occupancy: ut.max_occupancy,
      base_occupancy: ut.base_occupancy,
      beds_single: ut.beds_single,
      beds_double: ut.beds_double,
      sort_order: ut.sort_order,
      bookable_online: (ut as any).bookable_online == null ? true : !!Number((ut as any).bookable_online),
      breakfast_included: ((ut as any).breakfast_included == null ? '' : (Number((ut as any).breakfast_included) ? '1' : '0')) as '' | '1' | '0',
    });
    setError('');
    setEditTypeModal(true);
  };

  const openAddType = (categoryId: string) => {
    setEditingType(null);
    setTypeForm({
      name: '',
      code: '',
      category_id: categoryId,
      max_adults: 2,
      max_children: 2,
      max_occupancy: 4,
      base_occupancy: 2,
      beds_single: 0,
      beds_double: 1,
      sort_order: 0,
      bookable_online: true,
      breakfast_included: '' as '' | '1' | '0',
    });
    setError('');
    setEditTypeModal(true);
  };

  const handleSaveType = async () => {
    if (!typeForm.name || !typeForm.code) {
      setError(tUi('Назва і код обов\'язкові'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const url = editingType ? `/api/unit-types/${editingType.id}` : '/api/unit-types';
      const method = editingType ? 'PATCH' : 'POST';
      const body: any = {
        ...typeForm,
        // Три стани: '' означає «вирішує правило готелю» і їде як null.
        breakfast_included: typeForm.breakfast_included === '' ? null : Number(typeForm.breakfast_included),
      };
      if (!editingType) body.property_id = propertyId;

      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Помилка збереження');
        return;
      }
      setEditTypeModal(false);
      fetchData();
    } catch (e: any) {
      setError(e.message || 'Помилка мережі');
    } finally {
      setSaving(false);
    }
  };

  const openDeleteType = (ut: UnitTypeFromAPI) => {
    setDeleteTypeTarget(ut);
    setDeleteError('');
    setDeleteTypeModal(true);
  };

  const handleDeleteType = async () => {
    if (!deleteTypeTarget) return;
    setSaving(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/unit-types/${deleteTypeTarget.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error || 'Помилка видалення');
        setSaving(false);
        return;
      }
      setDeleteTypeModal(false);
      fetchData();
    } catch (e: any) {
      setDeleteError(e.message || 'Помилка мережі');
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────
  const totalUnits = units.length;

  if (loading) {
    return (
      <>
        <Header title={tUi('Номери / Юніти')} onMenuClick={onMenuClick} />
        <div className="app-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
          <Loader2 size={32} className="spin" style={{ color: 'var(--accent-primary)' }} />
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={tUi('Номери / Юніти')} onMenuClick={onMenuClick} />
      <div className="app-content">
        <PropertyRequired>
        {/* Page header */}
        <div className="page-header">
          <div>
            <h2 className="page-title">{tUi('Управління юнітами')}</h2>
            <div className="page-subtitle">{tUi('Всього:')} {totalUnits} {tUi('юнітів ·')} {unitTypes.length} {tUi('типів ·')} {categories.length} {tUi('категорій')}</div>
          </div>
          <button className="btn btn-primary" onClick={openBulk} disabled={categories.length === 0 || unitTypes.length === 0}>
            <Plus size={14} /> {tUi('Додати номери діапазоном')}
          </button>
        </div>

        {/* Unit Types summary */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <BedDouble size={16} style={{ color: 'var(--text-tertiary)' }} />
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{tUi('Типи кімнат')}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {unitTypes.map(ut => (
              <div key={ut.id} style={{
                padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
              }}>
                <span style={{ fontWeight: 500 }}>{ut.name}</span>
                <span className="badge badge-primary" style={{ fontSize: 10 }}>{ut.unit_count}</span>
                <button className="btn btn-sm btn-ghost btn-icon" onClick={() => openEditType(ut)} style={{ padding: 2 }}>
                  <Edit3 size={12} />
                </button>
                <button className="btn btn-sm btn-ghost btn-icon" onClick={() => openDeleteType(ut)} style={{ padding: 2, color: 'var(--accent-danger)' }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Category tree */}
        <div className="settings-tree">
          {displayGroups.map((group) => (
            <div className="settings-tree-group" key={group.categoryType}>
              {/* Category header */}
              <div className="settings-tree-header" onClick={() => toggleGroup(group.categoryType)}>
                <div className="settings-tree-header-left">
                  <span className={`settings-tree-chevron ${!collapsed[group.categoryType] ? 'open' : ''}`}>
                    <ChevronRight size={16} />
                  </span>
                  {categoryIcons[group.categoryType] || <Building2 size={18} />}
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{group.categoryName}</span>
                  <span className={`badge ${categoryBadge[group.categoryType] || 'badge-primary'}`}>
                    {group.subGroups.reduce((s, sg) => s + sg.units.length, 0)}
                  </span>
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={(e) => { e.stopPropagation(); openAddType(group.categoryId); }}
                  title={tUi('Додати тип кімнати')}
                >
                  <Plus size={14} />
                </button>
              </div>

              {/* Sub-groups */}
              {!collapsed[group.categoryType] && (
                <div className="settings-tree-children">
                  {group.subGroups.map((sub) => (
                    <div key={sub.key}>
                      {/* Sub-group header */}
                      <div
                        className="settings-tree-item"
                        style={{ paddingLeft: 32, background: 'var(--bg-secondary)', cursor: 'pointer' }}
                        onClick={() => toggleSub(sub.key)}
                      >
                        <div className="settings-tree-item-info">
                          <span className={`settings-tree-chevron ${!collapsedSub[sub.key] ? 'open' : ''}`}>
                            <ChevronRight size={14} />
                          </span>
                          <Home size={14} style={{ color: 'var(--text-tertiary)' }} />
                          <span style={{ fontWeight: 500, fontSize: 13 }}>{sub.label}</span>
                          <span className="badge badge-primary" style={{ fontSize: 10 }}>{sub.units.length}</span>
                        </div>
                      </div>

                      {/* Units */}
                      {!collapsedSub[sub.key] &&
                        sub.units.map((unit) => (
                          <div className="settings-tree-item" key={unit.id} style={{ paddingLeft: 56 }}>
                            <div className="settings-tree-item-info">
                              <div style={{
                                width: 32, height: 32, borderRadius: 'var(--radius-sm)',
                                background: 'var(--bg-tertiary)', display: 'flex',
                                alignItems: 'center', justifyContent: 'center', fontSize: 14,
                              }}>
                                {group.categoryIcon || '🛏️'}
                              </div>
                              <div>
                                <div style={{ fontWeight: 500, fontSize: 13 }}>{unit.name}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                  {unit.code}
                                  {unit.beds > 0 && ` · ${unit.beds} ${pluralUi(unit.beds, 'місць')}`}
                                  {unit.zone && ` · ${unit.zone}`}
                                  {unit.unit_type_name && ` · ${unit.unit_type_name}`}
                                </div>
                                {unit.lock_code && (
                                  <div style={{ fontSize: 11, color: 'var(--accent-success)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                    <Key size={10} /> {tUi('Код:')} {unit.lock_code}
                                    {unit.entry_photo_url && <><Camera size={10} style={{ marginLeft: 6 }} /> {tUi('Фото')}</>}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="settings-tree-item-actions">
                              <button className="btn btn-sm btn-ghost btn-icon" onClick={() => openEditUnit(unit)}>
                                <Edit3 size={14} />
                              </button>
                              <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-danger)' }} onClick={() => openDeleteUnit(unit)}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Edit Unit Modal */}
        <Modal
          open={editUnitModal}
          onClose={() => setEditUnitModal(false)}
          title={editingUnit ? `${tUi('Редагувати:')} ${editingUnit.name}` : tUi('Додати новий юніт')}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setEditUnitModal(false)}>{tUi('Скасувати')}</button>
              <button className="btn btn-primary" onClick={handleSaveUnit} disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                {editingUnit ? tUi('Зберегти') : tUi('Створити')}
              </button>
            </>
          }
        >
          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'rgba(239,68,68,0.1)', color: 'var(--accent-danger)', marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Назва')}</label>
              <input className="form-input" value={unitForm.name} onChange={(e) => setUnitForm((p) => ({ ...p, name: e.target.value }))} placeholder={tUi('Напр.: F12')} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Код')}</label>
              <input className="form-input" value={unitForm.code} onChange={(e) => setUnitForm((p) => ({ ...p, code: e.target.value }))} placeholder={tUi('Напр.: F12')} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Тип кімнати')}</label>
              <select className="form-select" value={unitForm.unit_type_id} onChange={(e) => setUnitForm((p) => ({ ...p, unit_type_id: e.target.value }))}>
                <option value="">{tUi('Оберіть тип')}</option>
                {unitTypes.map(ut => (
                  <option key={ut.id} value={ut.id}>{ut.name} ({ut.category_type})</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Спальних місць')}</label>
              <input className="form-input" type="number" value={unitForm.beds} onChange={(e) => setUnitForm((p) => ({ ...p, beds: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Зона')}</label>
              <input className="form-input" value={unitForm.zone} onChange={(e) => setUnitForm((p) => ({ ...p, zone: e.target.value }))} placeholder={tUi('Напр.: східне крило')} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Статус')}</label>
              <select className="form-select" value={unitForm.room_status} onChange={(e) => setUnitForm((p) => ({ ...p, room_status: e.target.value }))}>
                <option value="available">{tUi('Доступний')}</option>
                <option value="occupied">{tUi('Зайнятий')}</option>
                <option value="maintenance">{tUi('Обслуговування')}</option>
                <option value="blocked">{tUi('Заблокований')}</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Прибирання')}</label>
              <select className="form-select" value={unitForm.cleaning_status} onChange={(e) => setUnitForm((p) => ({ ...p, cleaning_status: e.target.value }))}>
                <option value="clean">{tUi('Чистий')}</option>
                <option value="dirty">{tUi('Брудний')}</option>
                <option value="in_progress">{tUi('Прибирається')}</option>
              </select>
            </div>
          </div>

          {/* Guest page: Entry code & photo */}
          <div style={{ borderTop: '1px solid var(--border-primary)', marginTop: 16, paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Key size={14} /> {tUi('Гостьова сторінка — код заїзду')}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">{tUi('Код замка')}</label>
                <input className="form-input" value={unitForm.lock_code} onChange={(e) => setUnitForm((p) => ({ ...p, lock_code: e.target.value }))} placeholder={tUi('Напр.: 1234#')} />
              </div>
            </div>
            <ImageUploadField
              label={tUi('Фото входу / лок-бокса')}
              value={unitForm.entry_photo_url}
              onChange={(url) => setUnitForm((p) => ({ ...p, entry_photo_url: url }))}
              folder="entry-photos"
            />
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
              {tUi('💡 Якщо порожньо — буде використано код/фото з налаштувань типу кімнати (Guest Page Settings)')}
            </div>
          </div>
        </Modal>

        {/* Bulk rooms — the shape a hotel is actually entered in */}
        <Modal
          open={bulkModal}
          onClose={() => setBulkModal(false)}
          title={tUi('Додати номери діапазоном')}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setBulkModal(false)}>{tUi('Закрити')}</button>
              <button className="btn btn-primary" onClick={handleBulkCreate} disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {tUi('Створити')}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            {error && (
              <div className="alert alert-danger" style={{ fontSize: 13 }}>
                <AlertTriangle size={14} /> {error}
              </div>
            )}
            {bulkResult && (
              <div className="alert alert-success" style={{ fontSize: 13 }}>{bulkResult}</div>
            )}

            <div className="form-group">
              <label className="form-label">{tUi('Категорія')}</label>
              <select
                className="form-select"
                value={bulkForm.category_id}
                onChange={(e) => setBulkForm((p) => ({ ...p, category_id: e.target.value, unit_type_id: '' }))}
              >
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">{tUi('Тип номера')}</label>
              <select
                className="form-select"
                value={bulkForm.unit_type_id}
                onChange={(e) => setBulkForm((p) => ({ ...p, unit_type_id: e.target.value }))}
              >
                <option value="">—</option>
                {unitTypes.filter((ut) => !bulkForm.category_id || ut.category_id === bulkForm.category_id)
                  .map((ut) => <option key={ut.id} value={ut.id}>{ut.name}</option>)}
              </select>
            </div>


            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">{tUi('Префікс')}</label>
                <input
                  className="form-input"
                  value={bulkForm.prefix}
                  placeholder="2"
                  onChange={(e) => setBulkForm((p) => ({ ...p, prefix: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{tUi('від')}</label>
                <input
                  className="form-input" type="number" value={bulkForm.from}
                  onChange={(e) => setBulkForm((p) => ({ ...p, from: Number(e.target.value) }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{tUi('до')}</label>
                <input
                  className="form-input" type="number" value={bulkForm.to}
                  onChange={(e) => setBulkForm((p) => ({ ...p, to: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              {tUi('Буде створено:')} <b>{Math.max(0, Number(bulkForm.to) - Number(bulkForm.from) + 1)}</b>
              {' — '}
              {bulkForm.prefix}{bulkForm.from} … {bulkForm.prefix}{bulkForm.to}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">{tUi('Ліжок')}</label>
                <input
                  className="form-input" type="number" value={bulkForm.beds}
                  onChange={(e) => setBulkForm((p) => ({ ...p, beds: Number(e.target.value) }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{tUi('Поверх / зона (необовʼязково)')}</label>
                <input
                  className="form-input" value={bulkForm.zone}
                  onChange={(e) => setBulkForm((p) => ({ ...p, zone: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </Modal>

        {/* Edit Unit Type Modal */}
        <Modal
          open={editTypeModal}
          onClose={() => setEditTypeModal(false)}
          title={editingType ? `${tUi('Редагувати тип:')} ${editingType.name}` : tUi('Додати тип кімнати')}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setEditTypeModal(false)}>{tUi('Скасувати')}</button>
              <button className="btn btn-primary" onClick={handleSaveType} disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                {editingType ? tUi('Зберегти') : tUi('Створити')}
              </button>
            </>
          }
        >
          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'rgba(239,68,68,0.1)', color: 'var(--accent-danger)', marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Назва')}</label>
              <input className="form-input" value={typeForm.name} onChange={(e) => setTypeForm((p) => ({ ...p, name: e.target.value }))} placeholder={tUi('Напр.: Stealth House (2 місця)')} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Код')}</label>
              <input className="form-input" value={typeForm.code} onChange={(e) => setTypeForm((p) => ({ ...p, code: e.target.value }))} placeholder={tUi('Напр.: STEALTH')} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Категорія')}</label>
              <select className="form-select" value={typeForm.category_id} onChange={(e) => setTypeForm((p) => ({ ...p, category_id: e.target.value }))}>
                <option value="">{tUi('Оберіть категорію')}</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Макс. дорослих')}</label>
              <input className="form-input" type="number" value={typeForm.max_adults} onChange={(e) => setTypeForm((p) => ({ ...p, max_adults: Number(e.target.value) }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Base occupancy</label>
              <input className="form-input" type="number" value={typeForm.base_occupancy} onChange={(e) => setTypeForm((p) => ({ ...p, base_occupancy: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={typeForm.bookable_online}
                  onChange={(e) => setTypeForm((p) => ({ ...p, bookable_online: e.target.checked }))} />
                {tUi('Продається онлайн')}
              </label>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {tUi('Вимкнено — номер продає лише рецепція, на сайті його немає.')}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Сніданок у цінах типу')}</label>
              <select className="form-select" value={typeForm.breakfast_included}
                onChange={(e) => setTypeForm((p) => ({ ...p, breakfast_included: e.target.value as '' | '1' | '0' }))}>
                <option value="">{tUi('За правилом готелю')}</option>
                <option value="1">{tUi('Входить у ціну')}</option>
                <option value="0">{tUi('Окремо / не входить')}</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Одномісних ліжок')}</label>
              <input className="form-input" type="number" value={typeForm.beds_single} onChange={(e) => setTypeForm((p) => ({ ...p, beds_single: Number(e.target.value) }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Двомісних ліжок')}</label>
              <input className="form-input" type="number" value={typeForm.beds_double} onChange={(e) => setTypeForm((p) => ({ ...p, beds_double: Number(e.target.value) }))} />
            </div>
          </div>
        </Modal>

        {/* Delete Unit Confirmation */}
        <Modal
          open={deleteUnitModal}
          onClose={() => setDeleteUnitModal(false)}
          title={tUi('Видалити юніт')}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDeleteUnitModal(false)}>{tUi('Скасувати')}</button>
              <button className="btn btn-danger" onClick={handleDeleteUnit} disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                {tUi('Видалити')}
              </button>
            </>
          }
        >
          {deleteError && (
            <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'rgba(239,68,68,0.1)', color: 'var(--accent-danger)', marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} /> {deleteError}
            </div>
          )}
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {tUi('Ви впевнені, що хочете видалити юніт')} <strong style={{ color: 'var(--text-primary)' }}>{deleteUnitTarget?.name}</strong>?
          </p>
        </Modal>

        {/* Delete Unit Type Confirmation */}
        <Modal
          open={deleteTypeModal}
          onClose={() => setDeleteTypeModal(false)}
          title={tUi('Видалити тип кімнати')}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDeleteTypeModal(false)}>{tUi('Скасувати')}</button>
              <button className="btn btn-danger" onClick={handleDeleteType} disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                {tUi('Видалити')}
              </button>
            </>
          }
        >
          {deleteError && (
            <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'rgba(239,68,68,0.1)', color: 'var(--accent-danger)', marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} /> {deleteError}
            </div>
          )}
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {tUi('Ви впевнені, що хочете видалити тип')} <strong style={{ color: 'var(--text-primary)' }}>{deleteTypeTarget?.name}</strong>?
          </p>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginTop: 4 }}>
            {tUi('Спочатку потрібно видалити або перепризначити всі юніти цього типу.')}
          </p>
        </Modal>
        </PropertyRequired>
      </div>
    </>
  );
}
