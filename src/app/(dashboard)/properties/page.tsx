'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/lib/MobileMenuContext';
import {
  Building2,
  Plus,
  BedDouble,
  Search,
  MapPin,
  ChevronRight,
  Settings2,
  PlusCircle,
  X,
  Loader2,
} from 'lucide-react';

interface Property {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  city: string;
  country: string;
  currency: string;
  active: boolean;
}

export default function PropertiesPage() {
  const onMenuClick = useMobileMenu();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [type, setType] = useState('hotel');
  const [city, setCity] = useState('Київ');
  const [country, setCountry] = useState('Україна');
  const [currency, setCurrency] = useState('UAH');

  const fetchProperties = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/properties');
      if (res.ok) {
        const data = await res.json();
        setProperties(data.properties || []);
      }
    } catch (e) {
      console.error('Failed to load properties', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, city, country, currency }),
      });

      if (res.ok) {
        setName('');
        setShowCreateModal(false);
        fetchProperties();
      }
    } catch (e) {
      console.error('Failed to create property', e);
    }
  };

  const filteredProperties = properties.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.city?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <Header title="Об'єкти та Нерухомість" onMenuClick={onMenuClick} />
      <div className="app-content">
        {/* Top Header Card */}
        <div className="card" style={{ marginBottom: 20, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                Управління Об'єктами та Готелями
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4, margin: 0 }}>
                Керування готелями, глемпінгами, категоріями номерів та номерним фондом.
              </p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => setShowCreateModal(true)}
              style={{ gap: 8 }}
            >
              <Plus size={16} /> Створити Новий Об'єкт
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: 280 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input
              className="form-input"
              placeholder="Пошук за назвою чи містом..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 32 }}
            />
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 600 }}>
            Всього об'єктів: <span style={{ color: 'var(--text-primary)' }}>{filteredProperties.length}</span>
          </div>
        </div>

        {/* Properties Grid */}
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
            <Loader2 size={24} className="animate-spin" style={{ marginRight: 8 }} /> Завантаження об'єктів...
          </div>
        ) : filteredProperties.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <Building2 size={40} style={{ color: 'var(--text-tertiary)', marginBottom: 12, opacity: 0.5 }} />
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Об'єктів не знайдено</div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16 }}>
              Створіть свій перший об'єкт або змініть фільтри пошуку.
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreateModal(true)}>
              <Plus size={14} /> Створити Об'єкт
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {filteredProperties.map((p) => (
              <div key={p.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 20 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span className="badge badge-primary" style={{ textTransform: 'uppercase', fontSize: 10 }}>
                      {p.type || 'Hotel'}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={12} /> {p.city}, {p.country}
                    </span>
                  </div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 8px 0', color: 'var(--text-primary)' }}>
                    {p.name}
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span>Валюта: <strong style={{ color: 'var(--text-secondary)' }}>{p.currency}</strong></span>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-primary)', marginTop: 20, paddingTop: 16, display: 'flex', gap: 8 }}>
                  <Link
                    href={`/properties/${p.id}`}
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1, justifyContent: 'center', gap: 6 }}
                  >
                    <Settings2 size={14} /> Керувати Номерами <ChevronRight size={14} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal create property */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 460, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Building2 size={20} style={{ color: 'var(--accent-primary)' }} /> Новий Об'єкт / Готель
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label">Назва Об'єкту</label>
                <input
                  className="form-input"
                  required
                  placeholder="напр. Grand Hotel Kyiv Central"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="form-label">Тип Нерухомості</label>
                  <select className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="hotel">Готель</option>
                    <option value="glamping">Глемпінг</option>
                    <option value="resort">Резорт</option>
                    <option value="apartments">Апартаменти</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Основна Валюта</label>
                  <select className="form-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option value="UAH">UAH (₴)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="USD">USD ($)</option>
                    <option value="CZK">CZK (Kč)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="form-label">Місто</label>
                  <input className="form-input" value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Країна</label>
                  <input className="form-input" value={country} onChange={(e) => setCountry(e.target.value)} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowCreateModal(false)}
                >
                  Скасувати
                </button>
                <button type="submit" className="btn btn-primary btn-sm" style={{ gap: 6 }}>
                  <PlusCircle size={14} /> Створити Об'єкт
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
