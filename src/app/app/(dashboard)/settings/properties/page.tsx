'use client';

import { useT, usePlural } from '@core/i18n/client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import PropertyRequired from '@/components/layout/PropertyRequired';
import { EmptyState, LoadingState } from '@/components/ui/State';
import {
  Building2, Edit3, Trash2, Plus, Save, X, Check, Search,
  ChevronRight, ChevronDown, Tent, TreePine, BedDouble,
  Home, Loader2, RefreshCw, Copy, MapPin, Clock, Phone, Mail,
} from 'lucide-react';

/* ================================================================
   Types
   ================================================================ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

interface PropertyRow extends AnyRow {
  id: string; name: string; slug: string; address?: string; city?: string;
  country?: string; phone?: string; email?: string;
  check_in_time: string; check_out_time: string; city_tax_per_night?: number; is_active: number;
  checkout_balance_policy?: 'none' | 'warning' | 'blocking';
  category_count: number; unit_count: number; unit_type_count: number;
}

interface CategoryRow extends AnyRow {
  id: string; property_id: string; name: string; type: string;
  description?: string; sort_order: number; icon?: string; color?: string;
  unit_count: number;
}

interface UnitTypeRow extends AnyRow {
  id: string; property_id: string; category_id: string;
  name: string; code: string; max_adults: number; base_occupancy: number;
  beds_single: number; beds_double: number; sort_order: number; unit_count: number;
}

interface UnitRow extends AnyRow {
  id: string; unit_type_id: string; property_id: string; category_id: string;
  name: string; code: string; beds: number;
  zone?: string; room_status: string; cleaning_status: string; is_active: number;
  sort_order: number; unit_type_name?: string; category_name?: string;
  category_type?: string;
}

interface FeeRow extends AnyRow {
  id: string; property_id: string; name: string;
  /** ЯК множити. */
  type: 'per_stay' | 'per_night' | 'per_person' | 'per_person_per_night' | 'percentage';
  amount: number;
  /** КОГО рахувати: `adults` — це звільнення дітей від збору. */
  applies_to: 'all' | 'adults';
  /** ЧИЇ це гроші: `authority` — збір для громади, у документі без ПДВ. */
  collected_for: 'property' | 'authority';
  /** Уже в ціні ночі: показується в розбивці, до підсумку не додається. */
  is_included_in_price: boolean | number;
  is_active: boolean | number;
}

type ModalType = 'none' | 'property' | 'category' | 'unitType' | 'unit' | 'bulkUnit' | 'fee' | 'delete';

/* ================================================================
   Constants
   ================================================================ */
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  glamping: <Tent size={16} />,
  resort: <Building2 size={16} />,
  camping: <TreePine size={16} />,
  facility: <Building2 size={16} />,
  area: <MapPin size={16} />,
  zone: <MapPin size={16} />,
};

// Підписи типів збору. Словник дублює CHECK у схемі — і саме тому короткий:
// тип, якого тут немає, показується своїм технічним ім'ям, а не вгаданим
// словом. Побачити `per_fortnight` на екрані краще, ніж правдоподібну брехню.
const FEE_TYPE_LABEL: Record<string, string> = {
  per_stay: 'за проживання',
  per_night: 'за ніч',
  per_person: 'за особу',
  per_person_per_night: 'за особу за ніч',
  percentage: 'відсоток від проживання',
};

const CATEGORY_EMOJI: Record<string, string> = {
  glamping: '🏕️', resort: '🏨', camping: '⛺',
  facility: '🏭', area: '🌳', zone: '📍',
};

const CATEGORY_COLORS: Record<string, string> = {
  glamping: '#a78bfa', resort: '#60a5fa', camping: '#34d399',
  facility: '#f59e0b', area: '#22c55e', zone: '#6c7086',
};

const VISIBILITY_FLAGS = [
  { key: 'show_in_tasks', label: 'Задачі', color: '#3b82f6' },
  { key: 'show_in_finance', label: 'Фінанси', color: '#22c55e' },
  { key: 'show_in_booking', label: 'Бронювання', color: '#f59e0b' },
];

const STATUS_COLORS: Record<string, { label: string; color: string }> = {
  available: { label: 'Вільний', color: '#22c55e' },
  occupied: { label: 'Зайнятий', color: '#ef4444' },
  maintenance: { label: 'Обслуговування', color: '#f59e0b' },
  blocked: { label: 'Заблокований', color: '#6b7280' },
};

/* ================================================================
   Modal
   ================================================================ */
function Modal({ open, onClose, title, children, footer, size }: {
  open: boolean; onClose: () => void; title: string;
  children: React.ReactNode; footer?: React.ReactNode; size?: 'lg';
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${size === 'lg' ? 'modal-lg' : ''}`} onClick={(e) => e.stopPropagation()}>
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

/* ================================================================
   Main Component
   ================================================================ */
export default function SettingsPropertiesPage() {
  const pluralUi = usePlural();
  const tUi = useT();
  // ── Data ──
  const onMenuClick = useMobileMenu();
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  // Який обʼєкт відкрито — область у шапці, не власний стан
  // (check-property-scope). Список тут свій, бо картці потрібні поля, яких
  // оболонка не носить (адреса, часи, турзбір); після створення чи видалення
  // обʼєкта оболонку перепитуємо через `refresh`.
  const { propertyId, refresh } = usePropertyScope();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitTypeRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  // Збори поверх ціни за ніч. Таблиця `fees_taxes` існувала від початку і
  // квота її читала — а завести збір було нічим, крім файла готелю. Тобто в
  // кожного реального клієнта мито й прибирання в квоті були нулем, і це
  // мало вигляд «цей готель таких зборів не має».
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── UI State ──
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState('');

  // ── Modal State ──
  const [modal, setModal] = useState<ModalType>('none');
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Forms ──
  // country deliberately empty: jurisdiction (Meldeschein, invoice language,
  // the fiscal till) hangs off it, so it must be chosen, not inherited from
  // the first customer's default.
  const [propForm, setPropForm] = useState({ name: '', slug: '', address: '', city: '', country: '', phone: '', email: '', check_in_time: '15:00', check_out_time: '10:00', city_tax_per_night: 0, checkout_balance_policy: 'warning' as 'none' | 'warning' | 'blocking' });
  const [catForm, setCatForm] = useState({ name: '', type: 'hotel', description: '', icon: '🏨', color: '#60a5fa', sort_order: 0, show_in_tasks: 1, show_in_finance: 0, show_in_booking: 1 });
  const [utForm, setUtForm] = useState({ category_id: '', name: '', code: '', max_adults: 2, max_children: 2, max_occupancy: 4, base_occupancy: 2, beds_single: 0, beds_double: 1, beds_sofa: 0, extra_bed_available: 0, sort_order: 0 });
  const [unitForm, setUnitForm] = useState({ unit_type_id: '', category_id: '', name: '', code: '', beds: 2, floor: '', zone: '', notes: '', sort_order: 0 });
  const [bulkForm, setBulkForm] = useState({ unit_type_id: '', category_id: '', prefix: '', from: 1, to: 10, beds: 0, zone: '' });
  const [feeForm, setFeeForm] = useState({
    name: '', type: 'per_person_per_night', amount: 0,
    applies_to: 'all', collected_for: 'property',
    is_included_in_price: false, is_active: true,
  });
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string; name: string } | null>(null);

  // ── Fetch Properties List ──
  const fetchProperties = useCallback(async () => {
    try {
      const res = await fetch('/api/properties');
      const data = await res.json();
      if (Array.isArray(data)) setProperties(data);
    } catch (e) { console.error('Fetch properties error:', e); }
  }, []);

  // ── Fetch Property Details ──
  const fetchDetails = useCallback(async () => {
    if (!propertyId) { setCategories([]); setUnitTypes([]); setUnits([]); setFees([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}`);
      const data = await res.json();
      setCategories(data.categories || []);
      setUnitTypes(data.unitTypes || []);
      setUnits(data.units || []);
    } catch (e) { console.error('Fetch details error:', e); }
    // Збори — окремим запитом: `/api/properties/[id]` їх не віддає, а
    // розширювати його заради екрана означало б тягнути їх у кожного, хто
    // питає об'єкт.
    try {
      const res = await fetch('/api/fees');
      const data = await res.json();
      setFees(Array.isArray(data) ? data.filter((f: FeeRow) => f.property_id === propertyId) : []);
    } catch (e) { console.error('Fetch fees error:', e); }
    setLoading(false);
  }, [propertyId]);

  useEffect(() => { fetchProperties(); }, [fetchProperties]);
  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  // ── Helpers ──
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const toggle = (key: string) => setCollapsed(p => ({ ...p, [key]: !p[key] }));

  const currentProperty = properties.find(p => p.id === propertyId);

  // ── Filtered Units (search) ──
  const filteredUnits = useMemo(() => {
    if (!search) return units;
    const q = search.toLowerCase();
    return units.filter(u =>
      u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q) ||
      u.unit_type_name?.toLowerCase().includes(q) || u.category_name?.toLowerCase().includes(q)
    );
  }, [units, search]);

  // ── Tree structure ──
  const tree = useMemo(() => {
    return categories.map(cat => {
      const catUnitTypes = unitTypes.filter(ut => ut.category_id === cat.id);
      const catUnits = filteredUnits.filter(u => u.category_id === cat.id);
      return { category: cat, unitTypes: catUnitTypes, units: catUnits };
    });
  }, [categories, unitTypes, filteredUnits]);

  /* ════════════════════════════════════════════════════════════
     CRUD Operations
     ════════════════════════════════════════════════════════════ */

  // ── Property CRUD ──
  const openPropertyModal = (p?: PropertyRow) => {
    if (p) {
      setEditId(p.id);
      setPropForm({
        name: p.name, slug: p.slug, address: p.address || '', city: p.city || '',
        country: p.country || 'CZ', phone: p.phone || '', email: p.email || '',
        check_in_time: p.check_in_time, check_out_time: p.check_out_time,
        city_tax_per_night: p.city_tax_per_night ?? 0,
        checkout_balance_policy: p.checkout_balance_policy ?? 'warning',
      });
    } else {
      setEditId(null);
      setPropForm({ name: '', slug: '', address: '', city: '', country: 'CZ', phone: '', email: '', check_in_time: '15:00', check_out_time: '10:00', city_tax_per_night: 0, checkout_balance_policy: 'warning' });
    }
    setModal('property');
  };

  const saveProperty = async () => {
    if (!propForm.name) { alert(tUi('Назва обов\'язкова')); return; }
    setSaving(true);
    try {
      const slug = propForm.slug || propForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (editId) {
        await fetch(`/api/properties/${editId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...propForm, slug }),
        });
        showToast(tUi('Об\'єкт оновлено!'));
      } else {
        const res = await fetch('/api/properties', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...propForm, slug }),
        });
        const data = await res.json();
        if (res.ok) {
          // Оболонка дізнається про новий обʼєкт і відкриває його.
          await refresh(data.id);
          showToast(tUi('Об\'єкт створено!'));
        } else {
          alert(data.error || 'Помилка створення');
          setSaving(false);
          return;
        }
      }
      setModal('none');
      fetchProperties();
      fetchDetails();
    } catch { alert(tUi('Помилка мережі')); }
    setSaving(false);
  };

  // ── Category CRUD ──
  const openCategoryModal = (cat?: CategoryRow) => {
    if (cat) {
      setEditId(cat.id);
      setCatForm({ name: cat.name, type: cat.type, description: cat.description || '', icon: cat.icon || '🏕️', color: cat.color || '#a78bfa', sort_order: cat.sort_order, show_in_tasks: (cat as any).show_in_tasks ?? 1, show_in_finance: (cat as any).show_in_finance ?? 0, show_in_booking: (cat as any).show_in_booking ?? 1 });
    } else {
      setEditId(null);
      setCatForm({ name: '', type: 'hotel', description: '', icon: '🏨', color: '#60a5fa', sort_order: categories.length, show_in_tasks: 1, show_in_finance: 0, show_in_booking: 1 });
    }
    setModal('category');
  };

  const saveCategory = async () => {
    if (!catForm.name) { alert(tUi('Назва обов\'язкова')); return; }
    setSaving(true);
    try {
      if (editId) {
        await fetch(`/api/categories/${editId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(catForm),
        });
        showToast(tUi('Категорію оновлено!'));
      } else {
        const res = await fetch('/api/categories', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...catForm, property_id: propertyId }),
        });
        if (!res.ok) { const d = await res.json(); alert(tUi(d.error)); setSaving(false); return; }
        showToast(tUi('Категорію створено!'));
      }
      setModal('none');
      fetchDetails();
    } catch { alert(tUi('Помилка мережі')); }
    setSaving(false);
  };

  // ── Unit Type CRUD ──
  const openUnitTypeModal = (catId: string, ut?: UnitTypeRow) => {
    if (ut) {
      setEditId(ut.id);
      setUtForm({
        category_id: ut.category_id,
        name: ut.name, code: ut.code,
        max_adults: ut.max_adults, max_children: 2, max_occupancy: 4, base_occupancy: ut.base_occupancy,
        beds_single: ut.beds_single, beds_double: ut.beds_double, beds_sofa: 0,
        extra_bed_available: 0, sort_order: ut.sort_order,
      });
    } else {
      setEditId(null);
      setUtForm({
        category_id: catId,
        name: '', code: '', max_adults: 2, max_children: 2, max_occupancy: 4, base_occupancy: 2,
        beds_single: 0, beds_double: 1, beds_sofa: 0, extra_bed_available: 0, sort_order: 0,
      });
    }
    setModal('unitType');
  };

  const saveUnitType = async () => {
    if (!utForm.name || !utForm.code) { alert(tUi('Назва і код обов\'язкові')); return; }
    setSaving(true);
    try {
      if (editId) {
        const res = await fetch(`/api/unit-types/${editId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(utForm),
        });
        if (!res.ok) { const d = await res.json(); alert(d.error || 'Помилка оновлення'); setSaving(false); return; }
        showToast(tUi('Тип юніта оновлено!'));
      } else {
        const res = await fetch('/api/unit-types', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...utForm, property_id: propertyId }),
        });
        if (!res.ok) { const d = await res.json(); alert(tUi(d.error)); setSaving(false); return; }
        showToast(tUi('Тип юніта створено!'));
      }
      setModal('none');
      fetchDetails();
    } catch { alert(tUi('Помилка мережі')); }
    setSaving(false);
  };

  // ── Unit CRUD ──
  const openUnitModal = (catId: string, utId: string, u?: UnitRow) => {
    if (u) {
      setEditId(u.id);
      setUnitForm({
        unit_type_id: u.unit_type_id, category_id: u.category_id,
        name: u.name, code: u.code, beds: u.beds, floor: '', zone: u.zone || '',
        notes: '', sort_order: u.sort_order,
      });
    } else {
      setEditId(null);
      setUnitForm({
        unit_type_id: utId, category_id: catId,
        name: '', code: '', beds: 2, floor: '', zone: '', notes: '', sort_order: 0,
      });
    }
    setModal('unit');
  };

  const saveUnit = async () => {
    if (!unitForm.name || !unitForm.code) { alert(tUi('Назва і код обов\'язкові')); return; }
    setSaving(true);
    try {
      if (editId) {
        const res = await fetch(`/api/units/${editId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(unitForm),
        });
        if (!res.ok) { const d = await res.json(); alert(d.error || 'Помилка оновлення'); setSaving(false); return; }
        showToast(tUi('Юніт оновлено!'));
      } else {
        const res = await fetch('/api/units', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...unitForm, property_id: propertyId }),
        });
        if (!res.ok) { const d = await res.json(); alert(tUi(d.error)); setSaving(false); return; }
        showToast(tUi('Юніт створено!'));
      }
      setModal('none');
      fetchDetails();
    } catch { alert(tUi('Помилка мережі')); }
    setSaving(false);
  };

  // ── Bulk Unit Creation ──
  const openBulkModal = (catId: string, utId: string) => {
    setBulkForm({ unit_type_id: utId, category_id: catId, prefix: '', from: 1, to: 10, beds: 0, zone: '' });
    setModal('bulkUnit');
  };

  const saveBulk = async () => {
    if (!bulkForm.prefix) { alert(tUi('Префікс обов\'язковий')); return; }
    if (bulkForm.from > bulkForm.to) { alert(tUi('Від має бути менше За')); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/units', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bulkForm, property_id: propertyId, bulk: true }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Створено ${data.created} юнітів!`);
        setModal('none');
        fetchDetails();
      } else {
        alert(data.error || 'Помилка');
      }
    } catch { alert(tUi('Помилка мережі')); }
    setSaving(false);
  };

  // ── Збори CRUD ──
  const openFeeModal = (f?: FeeRow) => {
    if (f) {
      setEditId(f.id);
      setFeeForm({
        name: f.name, type: f.type, amount: Number(f.amount) || 0,
        applies_to: f.applies_to ?? 'all', collected_for: f.collected_for ?? 'property',
        is_included_in_price: Boolean(Number(f.is_included_in_price)),
        is_active: Boolean(Number(f.is_active)),
      });
    } else {
      setEditId(null);
      setFeeForm({
        name: '', type: 'per_person_per_night', amount: 0,
        applies_to: 'all', collected_for: 'property',
        is_included_in_price: false, is_active: true,
      });
    }
    setModal('fee');
  };

  const saveFee = async () => {
    if (!feeForm.name.trim()) { alert(tUi('Назва обов\'язкова')); return; }
    setSaving(true);
    try {
      const url = editId ? `/api/fees/${editId}` : '/api/fees';
      const res = await fetch(url, {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...feeForm, property_id: propertyId }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(editId ? tUi('Збір оновлено!') : tUi('Збір створено!'));
        setModal('none');
        fetchDetails();
      } else {
        // Сервер відмовляє реченням, яке готель може виправити — зокрема про
        // другий турзбір. Показуємо саме його, а не «400».
        alert(data.error || tUi('Помилка збереження'));
      }
    } catch { alert(tUi('Помилка мережі')); }
    setSaving(false);
  };

  // ── Delete ──
  const openDelete = (type: string, id: string, name: string) => {
    setDeleteTarget({ type, id, name });
    setModal('delete');
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    const urlMap: Record<string, string> = {
      property: `/api/properties/${deleteTarget.id}`,
      category: `/api/categories/${deleteTarget.id}`,
      unitType: `/api/unit-types/${deleteTarget.id}`,
      unit: `/api/units/${deleteTarget.id}`,
      fee: `/api/fees/${deleteTarget.id}`,
    };
    try {
      const res = await fetch(urlMap[deleteTarget.type], { method: 'DELETE' });
      if (res.ok) {
        showToast(`${deleteTarget.name} видалено!`);
        setModal('none');
        if (deleteTarget.type === 'property') {
          await refresh(null);
          fetchProperties();
        } else {
          fetchDetails();
        }
      } else {
        const d = await res.json();
        alert(d.error || 'Помилка видалення');
      }
    } catch { alert(tUi('Помилка мережі')); }
    setSaving(false);
  };

  /* ════════════════════════════════════════════════════════════
     Render
     ════════════════════════════════════════════════════════════ */
  return (
    <>
      <Header title={tUi('Об\'єкти')} onMenuClick={onMenuClick} />
      <div className="app-content">
        {/* Toast */}
        {toast && (
          <div style={{
            position: 'fixed', top: 80, right: 24, zIndex: 1000,
            background: 'var(--accent-success)', color: '#fff',
            padding: '12px 20px', borderRadius: 'var(--radius-md)',
            fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)', animation: 'fadeIn 0.3s ease',
          }}>
            <Check size={16} /> {toast}
          </div>
        )}

        {/* Page Header */}
        <div className="page-header">
          <div>
            <h2 className="page-title">{tUi('Об\'єкти розміщення')}</h2>
            <div className="page-subtitle">
              {properties.length} {tUi('об\'єктів · Керування структурою')}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => { fetchProperties(); fetchDetails(); }} title={tUi('Оновити')}>
              <RefreshCw size={16} />
            </button>
            <button className="btn btn-primary" onClick={() => openPropertyModal()}>
              <Plus size={16} /> {tUi('Додати об\'єкт')}
            </button>
          </div>
        </div>

        {/* Обʼєкт обирається в шапці (область обʼєкта). «Усі обʼєкти» тут
            не має сенсу — картка нижче показує один; без вибору просимо
            обрати, а не беремо перший. Порожній список лишає лише кнопку
            «Додати обʼєкт» у заголовку. */}
        {!propertyId && properties.length > 0 && <PropertyRequired>{null}</PropertyRequired>}
        {properties.length === 0 && !loading && (
          <EmptyState
            title={tUi('Обʼєктів ще немає')}
            hint={tUi('Заведіть перший обʼєкт: назву, адресу, часи заїзду й виїзду. Далі — категорії, типи номерів і самі номери.')}
            action={{ label: tUi('Додати об\'єкт'), onClick: () => openPropertyModal(), icon: <Plus size={14} /> }}
          />
        )}

        {/* Property Card */}
        {currentProperty && (
          <div className="card" style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{
              width: 80, height: 80, borderRadius: 'var(--radius-lg)',
              background: 'linear-gradient(135deg, var(--accent-primary), #a78bfa)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, flexShrink: 0,
            }}>
              🏨
            </div>
            <div style={{ flex: 1 }}>
              <div className="flex justify-between items-center">
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{currentProperty.name}</h3>
                  <div className="flex gap-3" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {(currentProperty.city || currentProperty.country) && (
                      <span className="flex items-center gap-2"><MapPin size={12} /> {currentProperty.city}{currentProperty.city && currentProperty.country ? ', ' : ''}{currentProperty.country}</span>
                    )}
                    <span className="flex items-center gap-2"><Clock size={12} /> Check-in {currentProperty.check_in_time} / Check-out {currentProperty.check_out_time}</span>
                    {currentProperty.phone && <span className="flex items-center gap-2"><Phone size={12} /> {currentProperty.phone}</span>}
                    {currentProperty.email && <span className="flex items-center gap-2"><Mail size={12} /> {currentProperty.email}</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-secondary btn-sm" onClick={() => openPropertyModal(currentProperty)}>
                    <Edit3 size={14} /> {tUi('Редагувати')}
                  </button>
                  {properties.length > 1 && (
                    <button className="btn btn-sm btn-ghost" style={{ color: 'var(--accent-danger)' }}
                      onClick={() => openDelete('property', currentProperty.id, currentProperty.name)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {categories.map(cat => (
                  <div key={cat.id} style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                    <div className="flex items-center gap-2" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                      <span>{CATEGORY_EMOJI[cat.type] || '📊'}</span> {cat.name}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{cat.unit_count}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{tUi('юнітів')}</div>
                  </div>
                ))}
                <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                  <div className="flex items-center gap-2" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                    <span>📊</span> {tUi('Всього')}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{units.length}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{tUi('юнітів')}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Збори й мито */}
        {currentProperty && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>{tUi('Збори й мито')}</h3>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {tUi('Додаються до ціни за ніч у розрахунку вартості. Порожньо — готель зборів не має.')}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => openFeeModal()}>
                <Plus size={14} /> {tUi('Збір')}
              </button>
            </div>

            {/* Турзбір уже стоїть колонкою об'єкта: попереджаємо ДО того, як
                готель заведе другий і отримає його в рахунку двічі. Сервер
                таке відхилить, але дізнатися про це краще раніше. */}
            {(currentProperty.city_tax_per_night ?? 0) > 0 && (
              <div style={{
                padding: 10, marginBottom: 12, fontSize: 12,
                background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
                borderLeft: '3px solid var(--accent-warning, #f59e0b)',
              }}>
                {tUi('Турзбір цього об\'єкта вже заданий у налаштуваннях:')}{' '}
                <b>{currentProperty.city_tax_per_night}</b> {tUi('за ніч. Другий збір «для громади» тут потрапив би в рахунок двічі, тому його не приймуть.')}
              </div>
            )}

            {fees.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>
                {tUi('Зборів немає')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {fees.map(f => (
                  <div key={f.id} className="flex justify-between items-center"
                    style={{
                      padding: 10, background: 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-md)',
                      opacity: Number(f.is_active) ? 1 : 0.5,
                    }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {f.name}
                        {f.collected_for === 'authority' && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-tertiary)' }}>
                            · {tUi('для громади')}
                          </span>
                        )}
                        {Boolean(Number(f.is_included_in_price)) && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-tertiary)' }}>
                            · {tUi('уже в ціні')}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {FEE_TYPE_LABEL[f.type] ? tUi(FEE_TYPE_LABEL[f.type]) : f.type}
                        {f.applies_to === 'adults' && ` · ${tUi('лише дорослі')}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div style={{ fontWeight: 700 }}>{Number(f.amount)}{f.type === 'percentage' ? ' %' : ''}</div>
                      <button className="btn btn-sm btn-ghost" title={tUi('Редагувати')} onClick={() => openFeeModal(f)}>
                        <Edit3 size={14} />
                      </button>
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--accent-danger)' }}
                        title={tUi('Видалити')} onClick={() => openDelete('fee', f.id, f.name)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Search + Add Category */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="flex gap-3 items-center" style={{ flexWrap: 'wrap' }}>
            <div className="search-box" style={{ minWidth: 250 }}>
              <Search size={14} className="search-icon" />
              <input className="form-input" placeholder={tUi('Пошук юнітів...')} style={{ paddingLeft: 34 }}
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => openCategoryModal()}>
              <Plus size={14} /> {tUi('Категорія')}
            </button>
            {search && (
              <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>
                <X size={14} /> {tUi('Скинути')}
              </button>
            )}
            <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)' }}>
              {search ? `${filteredUnits.length} ${tUi('з')} ${units.length} ${pluralUi(units.length, 'юнітів')}` : `${units.length} ${pluralUi(units.length, 'юнітів')}`}
            </div>
          </div>
        </div>

        {/* Loading */}
        {loading && <LoadingState />}

        {/* Tree View */}
        {!loading && (
          <div className="settings-tree">
            {tree.map(({ category: cat, unitTypes: catUTs, units: catUnits }) => (
              <div className="settings-tree-group" key={cat.id}>
                {/* Category Header */}
                <div className="settings-tree-header" onClick={() => toggle(`cat-${cat.id}`)}>
                  <div className="settings-tree-header-left">
                    <span className={`settings-tree-chevron ${!collapsed[`cat-${cat.id}`] ? 'open' : ''}`}>
                      <ChevronRight size={16} />
                    </span>
                    {CATEGORY_ICONS[cat.type] || <Building2 size={16} />}
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.name}</span>
                    <span className="badge" style={{
                      background: `${CATEGORY_COLORS[cat.type] || '#888'}22`,
                      color: CATEGORY_COLORS[cat.type] || '#888',
                    }}>
                      {catUnits.length}
                    </span>
                    {VISIBILITY_FLAGS.map(flag => {
                      const val = (cat as any)[flag.key];
                      return val ? (
                        <span key={flag.key} style={{
                          fontSize: 9, padding: '1px 5px', borderRadius: 3,
                          background: `${flag.color}18`, color: flag.color,
                          fontWeight: 600, letterSpacing: '0.3px',
                        }}>
                          {tUi(flag.label)}
                        </span>
                      ) : null;
                    })}
                  </div>
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-ghost" title={tUi('Додати тип юніта')} onClick={() => openUnitTypeModal(cat.id)}>
                      <BedDouble size={14} />
                    </button>
                    <button className="btn btn-sm btn-ghost" title={tUi('Редагувати')} onClick={() => openCategoryModal(cat)}>
                      <Edit3 size={14} />
                    </button>
                    <button className="btn btn-sm btn-ghost" style={{ color: 'var(--accent-danger)' }}
                      title={tUi('Видалити')} onClick={() => openDelete('category', cat.id, cat.name)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Expanded content */}
                {!collapsed[`cat-${cat.id}`] && (
                  <div className="settings-tree-children">
                    {catUTs.map(ut => {
                      const utUnits = catUnits.filter(u => u.unit_type_id === ut.id);
                      return renderUnitType(ut, utUnits, cat.id, 32);
                    })}
                  </div>
                )}
              </div>
            ))}

            {tree.length === 0 && !loading && (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
                {tUi('Немає категорій. Натисніть "+ Категорія" щоб почати.')}
              </div>
            )}
          </div>
        )}

        {/* ═══════════ MODALS ═══════════ */}

        {/* Property Modal */}
        <Modal open={modal === 'property'} onClose={() => setModal('none')}
          title={editId ? tUi('Редагувати об\'єкт') : tUi('Новий об\'єкт')}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setModal('none')}>{tUi('Скасувати')}</button>
            <button className="btn btn-primary" onClick={saveProperty} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-pulse" /> : <Save size={14} />}
              {editId ? tUi('Зберегти') : tUi('Створити')}
            </button>
          </>}>
          <div className="form-group">
            <label className="form-label">{tUi('Назва *')}</label>
            <input className="form-input" value={propForm.name} onChange={e => setPropForm(p => ({ ...p, name: e.target.value }))}
              placeholder={tUi('Назва об\'єкта')} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Адреса')}</label>
              <input className="form-input" value={propForm.address} onChange={e => setPropForm(p => ({ ...p, address: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Місто')}</label>
              <input className="form-input" value={propForm.city} onChange={e => setPropForm(p => ({ ...p, city: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Країна')}</label>
              <input className="form-input" value={propForm.country} onChange={e => setPropForm(p => ({ ...p, country: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Телефон')}</label>
              <input className="form-input" value={propForm.phone} onChange={e => setPropForm(p => ({ ...p, phone: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={propForm.email} onChange={e => setPropForm(p => ({ ...p, email: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Check-in</label>
              <input className="form-input" type="time" value={propForm.check_in_time} onChange={e => setPropForm(p => ({ ...p, check_in_time: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Check-out</label>
              <input className="form-input" type="time" value={propForm.check_out_time} onChange={e => setPropForm(p => ({ ...p, check_out_time: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Міський податок / ніч')}</label>
              <input className="form-input" type="number" min="0" step="0.01" value={propForm.city_tax_per_night}
                onChange={e => setPropForm(p => ({ ...p, city_tax_per_night: Number(e.target.value) }))} />
            </div>
          </div>
          {/* Блок 4 (0091): що робить виселення з несплаченим залишком. Одне поле
              налаштувань обʼєкта — джерело форми Hoteliera, General settings. */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Виселення з боргом')}</label>
              <select className="form-select" value={propForm.checkout_balance_policy}
                onChange={e => setPropForm(p => ({ ...p, checkout_balance_policy: e.target.value as 'none' | 'warning' | 'blocking' }))}>
                <option value="none">{tUi('Не перевіряти баланс')}</option>
                <option value="warning">{tUi('Попередити, але виселити')}</option>
                <option value="blocking">{tUi('Заборонити виселення з боргом')}</option>
              </select>
              <div className="form-hint">{tUi('Борг рахується з рахунку броні; без рахунку — зі статусу оплати.')}</div>
            </div>
          </div>
        </Modal>

        {/* Category Modal */}
        <Modal open={modal === 'category'} onClose={() => setModal('none')}
          title={editId ? tUi('Редагувати категорію') : tUi('Нова категорія')}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setModal('none')}>{tUi('Скасувати')}</button>
            <button className="btn btn-primary" onClick={saveCategory} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-pulse" /> : <Save size={14} />}
              {editId ? tUi('Зберегти') : tUi('Створити')}
            </button>
          </>}>
          <div className="form-group">
            <label className="form-label">{tUi('Назва *')}</label>
            <input className="form-input" value={catForm.name} onChange={e => setCatForm(p => ({ ...p, name: e.target.value }))} placeholder={tUi('Назва категорії')} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Тип *')}</label>
              {/* Free text with suggestions, not a closed list: the DB
                  dropped this CHECK long ago, provisioning writes 'hotel',
                  and a closed menu of one customer's six words refused
                  every other hotel's vocabulary. */}
              <input className="form-input" list="category-type-suggestions" value={catForm.type}
                placeholder="hotel" onChange={e => {
                  const t = e.target.value;
                  setCatForm(p => ({ ...p, type: t, icon: CATEGORY_EMOJI[t] || p.icon, color: CATEGORY_COLORS[t] || p.color }));
                }} />
              <datalist id="category-type-suggestions">
                <option value="hotel" />
                <option value="glamping" />
                <option value="resort" />
                <option value="camping" />
                <option value="facility" />
                <option value="area" />
                <option value="zone" />
              </datalist>
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Іконка')}</label>
              <input className="form-input" value={catForm.icon} onChange={e => setCatForm(p => ({ ...p, icon: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Колір')}</label>
              <input className="form-input" type="color" value={catForm.color} onChange={e => setCatForm(p => ({ ...p, color: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Порядок')}</label>
              <input className="form-input" type="number" value={catForm.sort_order} onChange={e => setCatForm(p => ({ ...p, sort_order: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{tUi('Опис')}</label>
            <input className="form-input" value={catForm.description} onChange={e => setCatForm(p => ({ ...p, description: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">{tUi('Відображати в модулях')}</label>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
              {VISIBILITY_FLAGS.map(flag => (
                <label key={flag.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!(catForm as any)[flag.key]}
                    onChange={e => setCatForm(f => ({ ...f, [flag.key]: e.target.checked ? 1 : 0 }))}
                  />
                  <span style={{ color: flag.color }}>{tUi(flag.label)}</span>
                </label>
              ))}
            </div>
          </div>
        </Modal>

        {/* Unit Type Modal */}
        <Modal open={modal === 'unitType'} onClose={() => setModal('none')}
          title={editId ? tUi('Редагувати тип юніта') : tUi('Новий тип юніта')}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setModal('none')}>{tUi('Скасувати')}</button>
            <button className="btn btn-primary" onClick={saveUnitType} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-pulse" /> : <Save size={14} />}
              {editId ? tUi('Зберегти') : tUi('Створити')}
            </button>
          </>}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Назва *')}</label>
              <input className="form-input" value={utForm.name} onChange={e => setUtForm(p => ({ ...p, name: e.target.value }))} placeholder={tUi('Тримісний')} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Код *')}</label>
              <input className="form-input" value={utForm.code} onChange={e => setUtForm(p => ({ ...p, code: e.target.value }))} placeholder="3BED" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Категорія')}</label>
              <select className="form-select" value={utForm.category_id} onChange={e => setUtForm(p => ({ ...p, category_id: e.target.value }))}>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Макс. дорослих')}</label>
              <input className="form-input" type="number" value={utForm.max_adults} min={1} onChange={e => setUtForm(p => ({ ...p, max_adults: Number(e.target.value) }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Базова місткість')}</label>
              <input className="form-input" type="number" value={utForm.base_occupancy} min={1} onChange={e => setUtForm(p => ({ ...p, base_occupancy: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Ліжка single')}</label>
              <input className="form-input" type="number" value={utForm.beds_single} min={0} onChange={e => setUtForm(p => ({ ...p, beds_single: Number(e.target.value) }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Ліжка double')}</label>
              <input className="form-input" type="number" value={utForm.beds_double} min={0} onChange={e => setUtForm(p => ({ ...p, beds_double: Number(e.target.value) }))} />
            </div>
          </div>
        </Modal>

        {/* Unit Modal */}
        <Modal open={modal === 'unit'} onClose={() => setModal('none')}
          title={editId ? tUi('Редагувати юніт') : tUi('Новий юніт')}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setModal('none')}>{tUi('Скасувати')}</button>
            <button className="btn btn-primary" onClick={saveUnit} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-pulse" /> : <Save size={14} />}
              {editId ? tUi('Зберегти') : tUi('Створити')}
            </button>
          </>}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Назва *')}</label>
              <input className="form-input" value={unitForm.name} onChange={e => setUnitForm(p => ({ ...p, name: e.target.value }))} placeholder="F12" />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Код *')}</label>
              <input className="form-input" value={unitForm.code} onChange={e => setUnitForm(p => ({ ...p, code: e.target.value }))} placeholder="F12" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Ліжок')}</label>
              <input className="form-input" type="number" value={unitForm.beds} min={0} onChange={e => setUnitForm(p => ({ ...p, beds: Number(e.target.value) }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Зона')}</label>
              <input className="form-input" value={unitForm.zone} onChange={e => setUnitForm(p => ({ ...p, zone: e.target.value }))} placeholder="FB" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{tUi('Тип юніта')}</label>
            <select className="form-select" value={unitForm.unit_type_id} onChange={e => setUnitForm(p => ({ ...p, unit_type_id: e.target.value }))}>
              {unitTypes.filter(ut => ut.category_id === unitForm.category_id).map(ut => (
                <option key={ut.id} value={ut.id}>{ut.name} ({ut.code})</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{tUi('Нотатки')}</label>
            <input className="form-input" value={unitForm.notes} onChange={e => setUnitForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </Modal>

        {/* Bulk Unit Modal */}
        <Modal open={modal === 'bulkUnit'} onClose={() => setModal('none')}
          title={tUi('Масове створення юнітів')} size="lg"
          footer={<>
            <button className="btn btn-secondary" onClick={() => setModal('none')}>{tUi('Скасувати')}</button>
            <button className="btn btn-primary" onClick={saveBulk} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-pulse" /> : <Copy size={14} />}
              {tUi('Створити')} {bulkForm.to - bulkForm.from + 1} {tUi('юнітів')}
            </button>
          </>}>
          <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
            {tUi('💡 Юніти будуть створені з іменами:')} <strong>{bulkForm.prefix || '...'}{bulkForm.from}</strong> → <strong>{bulkForm.prefix || '...'}{bulkForm.to}</strong>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Префікс *')}</label>
              <input className="form-input" value={bulkForm.prefix} onChange={e => setBulkForm(p => ({ ...p, prefix: e.target.value }))} placeholder="FB" />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Від *')}</label>
              <input className="form-input" type="number" value={bulkForm.from} min={0} onChange={e => setBulkForm(p => ({ ...p, from: Number(e.target.value) }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('До *')}</label>
              <input className="form-input" type="number" value={bulkForm.to} min={0} onChange={e => setBulkForm(p => ({ ...p, to: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Ліжок на юніт')}</label>
              <input className="form-input" type="number" value={bulkForm.beds} min={0} onChange={e => setBulkForm(p => ({ ...p, beds: Number(e.target.value) }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Зона')}</label>
              <input className="form-input" value={bulkForm.zone} onChange={e => setBulkForm(p => ({ ...p, zone: e.target.value }))} placeholder={tUi('Зона (опціонально)')} />
            </div>
          </div>
        </Modal>

        {/* Збір */}
        <Modal open={modal === 'fee'} onClose={() => setModal('none')}
          title={editId ? tUi('Редагувати збір') : tUi('Новий збір')} size="lg"
          footer={<>
            <button className="btn btn-secondary" onClick={() => setModal('none')}>{tUi('Скасувати')}</button>
            <button className="btn btn-primary" onClick={saveFee} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-pulse" /> : <Save size={14} />}
              {tUi('Зберегти')}
            </button>
          </>}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Назва *')}</label>
              <input className="form-input" value={feeForm.name}
                onChange={e => setFeeForm(p => ({ ...p, name: e.target.value }))}
                placeholder={tUi('Прибирання')} />
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                {tUi('Цю назву гість побачить у розрахунку вартості та в рахунку.')}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('Сума *')}</label>
              <input className="form-input" type="number" min={0} step="0.01" value={feeForm.amount}
                onChange={e => setFeeForm(p => ({ ...p, amount: Number(e.target.value) }))} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{tUi('Як рахувати')}</label>
              <select className="form-select" value={feeForm.type}
                onChange={e => setFeeForm(p => ({ ...p, type: e.target.value }))}>
                {Object.entries(FEE_TYPE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>{tUi(label)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{tUi('З кого')}</label>
              <select className="form-select" value={feeForm.applies_to}
                onChange={e => setFeeForm(p => ({ ...p, applies_to: e.target.value }))}>
                <option value="all">{tUi('З усіх гостей')}</option>
                <option value="adults">{tUi('Лише з дорослих')}</option>
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                {tUi('«Лише з дорослих» — це звільнення дітей від збору. Діє на типи «за особу».')}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">{tUi('Чиї це гроші')}</label>
            <select className="form-select" value={feeForm.collected_for}
              onChange={e => setFeeForm(p => ({ ...p, collected_for: e.target.value }))}>
              <option value="property">{tUi('Виручка готелю (прибирання, сніданок)')}</option>
              <option value="authority">{tUi('Збір для громади — готель лише передає (турзбір)')}</option>
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
              {tUi('Збір для громади йде в документ окремим рядком і не оподатковується ПДВ.')}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label flex items-center gap-2">
                <input type="checkbox" checked={feeForm.is_included_in_price}
                  onChange={e => setFeeForm(p => ({ ...p, is_included_in_price: e.target.checked }))} />
                {tUi('Уже входить у ціну за ніч')}
              </label>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                {tUi('Показується в розбивці, але до підсумку не додається — інакше гість заплатив би двічі.')}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label flex items-center gap-2">
                <input type="checkbox" checked={feeForm.is_active}
                  onChange={e => setFeeForm(p => ({ ...p, is_active: e.target.checked }))} />
                {tUi('Активний')}
              </label>
            </div>
          </div>
        </Modal>

        {/* Delete Confirmation */}
        <Modal open={modal === 'delete'} onClose={() => setModal('none')}
          title={tUi('Підтвердження видалення')}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setModal('none')}>{tUi('Скасувати')}</button>
            <button className="btn btn-danger" onClick={confirmDelete} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-pulse" /> : <Trash2 size={14} />}
              {tUi('Видалити')}
            </button>
          </>}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {tUi('Ви впевнені, що хочете видалити')} <strong style={{ color: 'var(--text-primary)' }}>{deleteTarget?.name}</strong>?
          </p>
          <p style={{ color: 'var(--accent-danger)', fontSize: 13, marginTop: 8 }}>
            {tUi('⚠️ Ця дія може бути незворотною. Всі пов\'язані дані можуть бути видалені.')}
          </p>
        </Modal>
      </div>
    </>
  );

  /* ════════════════════════════════════════════════════════════
     Render Unit Type (reused in tree)
     ════════════════════════════════════════════════════════════ */
  function renderUnitType(ut: UnitTypeRow, utUnits: UnitRow[], catId: string, paddingLeft = 32) {
    return (
      <div key={ut.id}>
        {/* Unit Type Header */}
        <div className="settings-tree-item" style={{ paddingLeft, background: 'var(--bg-secondary)', cursor: 'pointer' }}
          onClick={() => toggle(`ut-${ut.id}`)}>
          <div className="settings-tree-item-info">
            <span className={`settings-tree-chevron ${!collapsed[`ut-${ut.id}`] ? 'open' : ''}`}>
              <ChevronRight size={14} />
            </span>
            <BedDouble size={14} style={{ color: 'var(--text-tertiary)' }} />
            <span style={{ fontWeight: 500, fontSize: 13 }}>
              {ut.name}
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                [{ut.code}] · {ut.max_adults} {tUi('місць')}
              </span>
            </span>
            <span className="badge badge-primary" style={{ fontSize: 10 }}>{utUnits.length}</span>
          </div>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <button className="btn btn-sm btn-ghost" title={tUi('Додати юніт')} onClick={() => openUnitModal(catId, ut.id)}>
              <Plus size={14} />
            </button>
            <button className="btn btn-sm btn-ghost" title={tUi('Масове створення')} onClick={() => openBulkModal(catId, ut.id)}>
              <Copy size={14} />
            </button>
            <button className="btn btn-sm btn-ghost btn-icon" title={tUi('Редагувати')} onClick={() => openUnitTypeModal(catId, ut)}>
              <Edit3 size={14} />
            </button>
            <button className="btn btn-sm btn-ghost btn-icon" title={tUi('Видалити')} style={{ color: 'var(--accent-danger)' }}
              onClick={() => openDelete('unitType', ut.id, ut.name)}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Units */}
        {!collapsed[`ut-${ut.id}`] && utUnits.map(unit => (
          <div className="settings-tree-item" key={unit.id} style={{ paddingLeft: paddingLeft + 24 }}>
            <div className="settings-tree-item-info">
              <div style={{
                width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-tertiary)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0,
              }}>
                {CATEGORY_EMOJI[unit.category_type || ''] || '🏨'}
              </div>
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{unit.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {unit.code}
                  {unit.beds > 0 && ` · ${unit.beds} ${pluralUi(unit.beds, 'місць')}`}
                  {unit.zone && ` · ${unit.zone}`}
                  {unit.room_status && unit.room_status !== 'available' && (
                    <span style={{ marginLeft: 4, color: STATUS_COLORS[unit.room_status]?.color }}>
                      · {tUi(STATUS_COLORS[unit.room_status]?.label)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="settings-tree-item-actions">
              <button className="btn btn-sm btn-ghost btn-icon" onClick={() => openUnitModal(catId, ut.id, unit)}>
                <Edit3 size={14} />
              </button>
              <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-danger)' }}
                onClick={() => openDelete('unit', unit.id, unit.name)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }
}
