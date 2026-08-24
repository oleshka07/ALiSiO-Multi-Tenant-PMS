'use client';

/**
 * The supplier's entrance. Not linked from the customer login screen on
 * purpose — a door that opens every hotel does not belong in the navigation a
 * receptionist uses. Reached by typing the address.
 */
import { useT } from '@core/i18n/client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PlatformLoginPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/platform/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok) router.push('/app/platform');
      else setError(data.error || t('Помилка входу'));
    } catch {
      setError(t('Помилка мережі'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon" style={{ background: '#0f172a' }}>A</div>
          <h1 className="login-logo-text">ALiSiO Platform</h1>
          <p className="login-subtitle">{t('Вхід постачальника')}</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          <div className="login-field">
            <label htmlFor="email">Email</label>
            <input
              id="email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              required autoComplete="email" autoFocus
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">{t('Пароль')}</label>
            <input
              id="password" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" required autoComplete="current-password"
            />
          </div>

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? <span className="login-spinner" /> : t('Увійти')}
          </button>
        </form>

        <div className="login-footer">
          {t('Кожен вхід у готель записується в його журнал змін.')}
        </div>
      </div>
    </div>
  );
}
