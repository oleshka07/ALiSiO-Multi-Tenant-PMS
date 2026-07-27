'use client';

import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import type { Property, Tenant } from '@/lib/store';
import { ArrowRight, Building, DollarSign, Home, MapPin, Plus, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

export default function HomePage() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string>(
    '00000000-0000-0000-0000-000000000001',
  );
  const [properties, setProperties] = useState<Property[]>([]);
  const [showPropertyModal, setShowPropertyModal] = useState(false);

  // Form State
  const [propName, setPropName] = useState('');
  const [propType, setPropType] = useState('glamping');
  const [city, setCity] = useState('Київ');

  const loadData = useCallback(async () => {
    try {
      const resTenants = await fetch('/api/tenants');
      const dataTenants = await resTenants.json();
      setTenants(dataTenants.tenants || []);

      const resProps = await fetch(`/api/properties?tenantId=${activeTenantId}`);
      const dataProps = await resProps.json();
      setProperties(dataProps.properties || []);
    } catch (err) {
      console.error(err);
    }
  }, [activeTenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propName) return;

    await fetch(`/api/properties?tenantId=${activeTenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: propName,
        type: propType,
        city,
      }),
    });

    setPropName('');
    setShowPropertyModal(false);
    loadData();
  };

  const activeTenant = tenants.find((t) => t.id === activeTenantId);

  return (
    <div className="app-layout">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <div className="app-main">
        <Header
          title="Об'єкти та Нерухомість (Properties)"
          tenants={tenants}
          activeTenantId={activeTenantId}
          onTenantChange={setActiveTenantId}
          onMenuClick={() => setMobileOpen(true)}
        />

        <main className="app-content space-y-6">
          {/* Top Banner */}
          <div className="card bg-gradient-to-r from-indigo-900/60 via-slate-800 to-purple-900/40 border border-indigo-500/30">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="badge badge-primary font-mono">Stage 1</span>
                  <span className="text-xs text-indigo-300 font-semibold uppercase tracking-wider">
                    Properties & Units Management
                  </span>
                </div>
                <h2 className="page-title mt-1">Управління Готелями та Глемпінгами</h2>
                <p className="page-subtitle">
                  Створення нових об'єктів, налаштування номерного фонду та керування категоріями.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowPropertyModal(true)}
                className="btn btn-primary"
              >
                <Plus size={16} /> Створити Новий Об'єкт
              </button>
            </div>
          </div>

          {/* Multi-Tenant Isolation Banner */}
          <div className="card bg-slate-800/80 border-emerald-500/40">
            <div className="flex items-center gap-3">
              <ShieldCheck className="text-emerald-400" size={24} />
              <div>
                <h3 className="text-sm font-bold text-emerald-400">
                  Ізоляція Даних Мультитенантності
                </h3>
                <p className="text-xs text-slate-300">
                  Активна організація:{' '}
                  <strong className="text-white">{activeTenant?.name || '---'}</strong> (ID:{' '}
                  {activeTenantId}). Всі запити безпечно фільтруються на рівні бази даних.
                </p>
              </div>
            </div>
          </div>

          {/* Stats Overview */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon blue">
                <Building size={22} />
              </div>
              <div>
                <div className="stat-value">{properties.length}</div>
                <div className="stat-label">Всього об'єктів</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon green">
                <Home size={22} />
              </div>
              <div>
                <div className="stat-value">12</div>
                <div className="stat-label">Активні номери / куполи</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon yellow">
                <DollarSign size={22} />
              </div>
              <div>
                <div className="stat-value">UAH</div>
                <div className="stat-label">Основна валюта</div>
              </div>
            </div>
          </div>

          {/* Properties Grid */}
          <section className="space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              🏨 Список Об'єктів ({properties.length})
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {properties.map((prop) => (
                <div
                  key={prop.id}
                  className="card space-y-4 flex flex-col justify-between hover:border-indigo-500/50"
                >
                  <div>
                    <div className="flex justify-between items-start">
                      <span className="badge badge-glamping uppercase">{prop.type}</span>
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <MapPin size={12} /> {prop.city}
                      </span>
                    </div>

                    <h4 className="text-lg font-bold text-white mt-3">{prop.name}</h4>
                    <p className="text-xs text-slate-400 mt-1">
                      {prop.address || 'Адреса не вказана'}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-700/60 flex justify-between items-center">
                    <span className="text-xs font-mono text-slate-400">{prop.currency}</span>
                    <Link href={`/properties/${prop.id}`} className="btn btn-secondary btn-sm">
                      Керувати Номерами <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
              ))}

              {properties.length === 0 && (
                <div className="col-span-full card text-center py-12 space-y-3">
                  <p className="text-slate-400 text-sm">
                    У цієї організації ще немає створених об'єктів.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowPropertyModal(true)}
                    className="btn btn-primary btn-sm"
                  >
                    + Створити перший об'єкт
                  </button>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      {/* Modal New Property */}
      {showPropertyModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Створити Новий Готель або Глемпінг</h3>
              <button
                type="button"
                onClick={() => setShowPropertyModal(false)}
                className="modal-close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProperty}>
              <div className="modal-body space-y-4">
                <div className="form-group">
                  <label htmlFor="propName" className="form-label">
                    Назва об'єкту *
                  </label>
                  <input
                    id="propName"
                    type="text"
                    required
                    placeholder="напр. Eco Glamping Dnipro"
                    value={propName}
                    onChange={(e) => setPropName(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="propType" className="form-label">
                    Тип об'єкту
                  </label>
                  <select
                    id="propType"
                    value={propType}
                    onChange={(e) => setPropType(e.target.value)}
                    className="form-select"
                  >
                    <option value="glamping">Глемпінг</option>
                    <option value="hotel">Готель</option>
                    <option value="villa">Вілла / Котедж</option>
                    <option value="apartment">Апартаменти</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="city" className="form-label">
                    Місто
                  </label>
                  <input
                    id="city"
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowPropertyModal(false)}
                  className="btn btn-secondary"
                >
                  Скасувати
                </button>
                <button type="submit" className="btn btn-primary">
                  Створити Об'єкт
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
