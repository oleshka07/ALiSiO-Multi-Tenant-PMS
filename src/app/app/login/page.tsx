'use client';

import { I18nProvider, useT } from '@core/i18n/client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseLanguage, type Language } from '@core/i18n/languages';

/**
 * Мова до входу — з браузера.
 *
 * До логіну система не знає ні користувача, ні готелю, а I18nProvider живе в
 * layout дашборда — тож ця сторінка лишалась українською для всіх. Дві
 * підписи, але це перший екран, який бачить персонал німецького готелю.
 * Після входу мова, як і раніше, резолвиться користувач → організація.
 */
function browserLanguage(): Language {
  if (typeof navigator === 'undefined') return 'uk';
  return parseLanguage((navigator.language || '').slice(0, 2), 'uk');
}

export default function LoginPage() {
  const [language] = useState<Language>(browserLanguage);
  return (
    <I18nProvider language={language}>
      <LoginForm />
    </I18nProvider>
  );
}

function LoginForm() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /**
   * Готелі, у які ця людина може увійти цим паролем.
   *
   * Одна адреса може бути власником у кількох готелях, і доти вхід мовчки
   * брав перший рядок за email — тобто в другий готель увійти було
   * неможливо взагалі. Сервер тепер звіряє пароль з усіма й, коли підходить
   * більше ніж один, повертає список замість сесії. Питаємо тут.
   */
  const [choices, setChoices] = useState<{ id: string; name: string; role: string }[] | null>(null);
  const router = useRouter();

  async function signIn(organizationId?: string) {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, organizationId }),
      });

      const data = await res.json();

      if (res.ok && data.needsOrganization) {
        setChoices(data.organizations || []);
      } else if (res.ok) {
        router.push('/app/dashboard');
      } else {
        // Текст помилки з сервера — українським ключем; перекладає екран.
        setError(t(data.error || 'Помилка входу'));
        setChoices(null);
      }
    } catch {
      setError(t('Помилка мережі'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await signIn();
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-icon">A</div>
          <h1 className="login-logo-text">ALiSiO ERP</h1>
          <p className="login-subtitle">Property Management System</p>
        </div>

        {/* Пароль підійшов до кількох готелів — лишилось сказати, до якого саме */}
        {choices && (
          <div className="login-form">
            <div className="login-field">
              <label>{t('Оберіть готель')}</label>
            </div>
            {choices.map((o) => (
              <button
                key={o.id}
                type="button"
                className="login-btn"
                disabled={loading}
                onClick={() => signIn(o.id)}
                style={{ marginBottom: 8 }}
              >
                {o.name}
              </button>
            ))}
            <button
              type="button"
              className="login-footer"
              onClick={() => { setChoices(null); setPassword(''); }}
              style={{ background: 'none', border: 0, cursor: 'pointer', width: '100%' }}
            >
              {t('Назад')}
            </button>
          </div>
        )}

        {/* Form */}
        {!choices && (
        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              {error}
            </div>
          )}

          <div className="login-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@hotel.com"
              required
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">{t('Пароль')}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="login-btn"
            disabled={loading}
          >
            {loading ? (
              <span className="login-spinner" />
            ) : (
              t('Увійти')
            )}
          </button>
        </form>
        )}

        <div className="login-footer">
          ALiSiO Properties © 2026
        </div>
      </div>
    </div>
  );
}
