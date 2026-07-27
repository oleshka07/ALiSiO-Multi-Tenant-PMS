'use client';

import Navbar from '@/components/Navbar';
import type { Property, Tenant } from '@/lib/store';
import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

export default function HomePage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string>(
    '00000000-0000-0000-0000-000000000001',
  );
  const [properties, setProperties] = useState<Property[]>([]);
  const [showPropertyModal, setShowPropertyModal] = useState(false);

  // New Property Form
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

  const activeTenantName =
    tenants.find((t) => t.id === activeTenantId)?.name || 'Обрана Організація';

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-12">
      <Navbar
        tenants={tenants}
        activeTenantId={activeTenantId}
        onTenantChange={setActiveTenantId}
      />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stage Banner */}
        <div className="bg-gradient-to-r from-indigo-900/60 to-purple-900/60 border border-indigo-500/30 rounded-2xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-xl">
          <div>
            <span className="px-3 py-1 bg-indigo-500/20 text-indigo-300 text-xs font-semibold rounded-full border border-indigo-500/30">
              Етап 1: Properties & Units Management
            </span>
            <h1 className="text-2xl font-extrabold text-white mt-2">
              Управління Готелями та Номерами
            </h1>
            <p className="text-slate-300 text-xs mt-1">
              Модуль для реєстрації компаній, створення об'єктів (готелів, глемпінгів) та
              налаштування категорій і номерів.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPropertyModal(true)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl shadow-lg transition"
          >
            + Створити Готель / Глемпінг
          </button>
        </div>

        {/* Multi-Tenant Isolation Testing Banner */}
        <div className="p-4 bg-slate-800/80 border border-emerald-500/30 rounded-xl space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse" />
            <h2 className="text-sm font-bold text-emerald-400">
              Перевірка Мультитенантності (Тест Ізоляції Даних):
            </h2>
          </div>
          <p className="text-xs text-slate-300">
            Зараз у системі відображаються об'єкти тільки для{' '}
            <strong className="text-white">"{activeTenantName}"</strong>. Перемкніть організацію у
            шапці зверху, щоб переконатися, що об'єкти однієї компанії повністю приховані від іншої!
          </p>
        </div>

        {/* Properties List */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            🏨 Об'єкти Організації ({properties.length})
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {properties.map((prop) => (
              <div
                key={prop.id}
                className="bg-slate-800/60 border border-slate-700/60 hover:border-indigo-500/50 rounded-2xl p-6 transition shadow-lg space-y-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start">
                    <span className="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 text-[10px] font-bold uppercase rounded border border-indigo-500/30">
                      {prop.type}
                    </span>
                    <span className="text-xs text-slate-400">{prop.city}</span>
                  </div>
                  <h3 className="text-lg font-bold text-white mt-3">{prop.name}</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    {prop.address || 'Адреса не вказана'}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-700/50 flex justify-between items-center">
                  <span className="text-xs font-mono text-slate-400">{prop.currency}</span>
                  <Link
                    href={`/properties/${prop.id}`}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white font-medium text-xs rounded-lg transition"
                  >
                    Керувати Номерами →
                  </Link>
                </div>
              </div>
            ))}

            {properties.length === 0 && (
              <div className="col-span-full p-8 text-center bg-slate-800/30 border border-dashed border-slate-700 rounded-2xl">
                <p className="text-slate-400 text-sm">
                  У цієї організації ще немає створених готелів або глемпінгів.
                </p>
                <button
                  type="button"
                  onClick={() => setShowPropertyModal(true)}
                  className="mt-3 text-xs text-indigo-400 hover:underline font-medium"
                >
                  + Створити перший об'єкт
                </button>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Modal New Property */}
      {showPropertyModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold text-white">Створити Новий Готель або Глемпінг</h3>
            <form onSubmit={handleCreateProperty} className="space-y-3">
              <div>
                <label htmlFor="propName" className="block text-xs text-slate-300 mb-1">
                  Назва об'єкту *
                </label>
                <input
                  id="propName"
                  type="text"
                  required
                  placeholder="напр. Eco Glamping Dnipro"
                  value={propName}
                  onChange={(e) => setPropName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>

              <div>
                <label htmlFor="propType" className="block text-xs text-slate-300 mb-1">
                  Тип об'єкту
                </label>
                <select
                  id="propType"
                  value={propType}
                  onChange={(e) => setPropType(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="glamping">Глемпінг</option>
                  <option value="hotel">Готель</option>
                  <option value="villa">Вілла / Котедж</option>
                  <option value="apartment">Апартаменти</option>
                </select>
              </div>

              <div>
                <label htmlFor="city" className="block text-xs text-slate-300 mb-1">
                  Місто
                </label>
                <input
                  id="city"
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowPropertyModal(false)}
                  className="px-3 py-2 bg-slate-700 text-xs rounded-lg text-slate-300"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs rounded-lg text-white font-medium shadow"
                >
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
