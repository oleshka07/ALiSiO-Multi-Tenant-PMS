'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type React from 'react';
import { useState } from 'react';

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    setLoading(true);
    const calculatedSlug =
      slug ||
      name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]/g, '');

    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug: calculatedSlug }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessage(`Організацію "${data.tenant.name}" успішно зареєстровано!`);
        setTimeout(() => {
          router.push('/');
        }, 1200);
      } else {
        setMessage('Помилка реєстрації організації.');
      }
    } catch (err) {
      setMessage('Помилка мережі.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-slate-800/80 border border-slate-700/60 rounded-2xl p-8 shadow-2xl space-y-6">
        <div>
          <Link href="/" className="text-xs text-indigo-400 hover:underline">
            ← Повернутися на головну
          </Link>
          <h1 className="text-2xl font-extrabold text-white mt-2">Реєстрація Нової Організації</h1>
          <p className="text-slate-400 text-xs mt-1">
            Створіть новий акаунт компанії (готелю, глемпінг чи мережі апартаментів).
          </p>
        </div>

        {message && (
          <div className="p-3 bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs rounded-lg text-center font-medium">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="orgName" className="block text-xs font-semibold text-slate-300 mb-1">
              Назва Організації / Бізнесу *
            </label>
            <input
              id="orgName"
              type="text"
              required
              placeholder="напр. Eco Glamping Dnipro"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="orgSlug" className="block text-xs font-semibold text-slate-300 mb-1">
              Унікальний Slug (Subdomain)
            </label>
            <input
              id="orgSlug"
              type="text"
              placeholder="напр. eco-glamping-dnipro"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Використовуватиметься для веб-адреси вашого кабінету.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg shadow-lg text-sm transition disabled:opacity-50"
          >
            {loading ? 'Зареєструвати...' : 'Зареєструвати Організацію'}
          </button>
        </form>
      </div>
    </div>
  );
}
