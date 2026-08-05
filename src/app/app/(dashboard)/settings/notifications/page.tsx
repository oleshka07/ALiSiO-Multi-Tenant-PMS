'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Save, Send, Unplug } from 'lucide-react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Events {
  newBooking: boolean;
  cancellation: boolean;
  guestRegistration: boolean;
  payment: boolean;
  dailyDigest: boolean;
  taskAssigned: boolean;
}

interface Settings {
  hasToken: boolean;
  chatId: string;
  adminChatIds: string[];
  events: Events;
  source: 'db' | 'env' | 'none';
  secretsConfigured: boolean;
}

const EVENT_LABELS: { key: keyof Events; label: string; hint: string }[] = [
  { key: 'newBooking', label: 'Нове бронювання', hint: 'Прямі бронювання, віджет і канали' },
  { key: 'cancellation', label: 'Скасування', hint: 'Гість або канал скасував бронювання' },
  { key: 'guestRegistration', label: 'Реєстрація гостя', hint: 'Гість заповнив дані на гостьовій сторінці' },
  { key: 'payment', label: 'Оплата', hint: 'Надходження через термінал або платіжний шлюз' },
  { key: 'dailyDigest', label: 'Щоденний зведений звіт', hint: 'Заїзди, виїзди й завантаження на день' },
  { key: 'taskAssigned', label: 'Призначення задачі', hint: 'Задачу призначено на працівника' },
];

export default function NotificationsSettingsPage() {
  const t = useT();
  const onMenuClick = useMobileMenu();
  const [s, setS] = useState<Settings | null>(null);
  const [token, setToken] = useState('');
  const [adminIds, setAdminIds] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/notifications');
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${data.error}`); return; }
      setS(data);
      setAdminIds((data.adminChatIds ?? []).join(', '));
    } catch (e: any) {
      showToast(`❌ ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: token, chatId: s.chatId, adminChatIds: adminIds, events: s.events }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${data.error}`); return; }
      setS(data);
      setAdminIds((data.adminChatIds ?? []).join(', '));
      setToken('');
      showToast('✅ Збережено');
    } catch (e: any) {
      showToast(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/settings/notifications/test', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) { showToast(`❌ ${data.error}`); return; }
      showToast(data.warning ? `⚠️ @${data.bot}: ${data.warning}` : `✅ @${data.bot} — тестове повідомлення надіслано`);
    } catch (e: any) {
      showToast(`❌ ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('Відключити Telegram? Збережений токен буде видалено.')) return;
    try {
      const res = await fetch('/api/settings/notifications', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { showToast(`❌ ${data.error}`); return; }
      setS(data);
      setAdminIds('');
      showToast('✅ Відключено');
    } catch (e: any) {
      showToast(`❌ ${e.message}`);
    }
  };

  const toggle = (k: keyof Events) => setS((p) => (p ? { ...p, events: { ...p.events, [k]: !p.events[k] } } : p));

  return (
    <>
      <Header title={t('Сповіщення')} onMenuClick={onMenuClick} />
      <div className="app-content">
        {toast && (
          <div style={{
            position: 'fixed', top: 80, right: 24, zIndex: 1000, maxWidth: 460,
            background: toast.startsWith('❌') ? 'var(--accent-danger)' : toast.startsWith('⚠️') ? 'var(--accent-warning)' : 'var(--accent-success)',
            color: '#fff', padding: '12px 20px', borderRadius: 'var(--radius-md)',
            fontWeight: 600, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}>{toast}</div>
        )}

        <div className="page-header">
          <div>
            <Link href="/app/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 4, textDecoration: 'none' }}>
              <ArrowLeft size={14} /> {t('Налаштування')}
            </Link>
            <h2 className="page-title">{t('Сповіщення')}</h2>
            <div className="page-subtitle">{t('Підключення Telegram-бота та вибір подій')}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {s?.hasToken && (
              <button className="btn btn-secondary" onClick={test} disabled={testing}>
                {testing ? <Loader2 size={16} className="animate-pulse" /> : <Send size={16} />} {t('Перевірити')}
              </button>
            )}
            <button className="btn btn-primary" onClick={save} disabled={saving || loading}>
              {saving ? <Loader2 size={16} className="animate-pulse" /> : <Save size={16} />} {t('Зберегти')}
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 64 }}>
            <Loader2 size={24} className="animate-pulse" style={{ display: 'inline-block' }} /> {t('Завантаження...')}
          </div>
        ) : !s ? null : (
          <>
            {!s.secretsConfigured && (
              <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--accent-warning)' }}>
                <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <AlertTriangle size={18} style={{ color: 'var(--accent-warning)', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                    <strong>{t('Ключ шифрування не налаштовано.')}</strong> {t('Токен бота неможливо зберегти в базі безпечно. Додайте')} <code>APP_SECRET_KEY</code> {t('у')} <code>.env.local</code> {t('— 64 шістнадцяткові символи:')}
                    <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)' }}>
                      node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;hex&apos;))&quot;
                    </div>
                  </div>
                </div>
              </div>
            )}

            {s.source === 'env' && (
              <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--accent-warning)' }}>
                <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <AlertTriangle size={18} style={{ color: 'var(--accent-warning)', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                    {t('Зараз використовуються змінні середовища сервера. Вони спільні для всіх організацій — збережіть налаштування тут, щоб бот належав саме цій організації.')}
                  </div>
                </div>
              </div>
            )}

            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <div className="card-title">{t('Telegram-бот')}</div>
                {s.hasToken && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--accent-success)' }}>
                    <CheckCircle2 size={14} /> {t('Підключено')}
                  </span>
                )}
              </div>
              <div style={{ padding: 20 }}>
                <div className="form-group">
                  <label className="form-label">{t('Токен бота')}</label>
                  <input
                    className="form-input"
                    type="password"
                    autoComplete="off"
                    placeholder={s.hasToken ? '•••••••• — збережено, введіть новий щоб замінити' : '123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  <div className="form-hint">
                    {t('Створіть бота у')} <strong>@BotFather</strong> {t('командою')} <code>/newbot</code> {t('і вставте виданий токен. Він зберігається зашифрованим і ніколи не повертається у браузер.')}
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Chat ID</label>
                    <input
                      className="form-input"
                      placeholder="-1001234567890"
                      value={s.chatId}
                      onChange={(e) => setS({ ...s, chatId: e.target.value })}
                    />
                    <div className="form-hint">
                      {t('Основний чат або група. Додайте бота в групу, напишіть повідомлення і відкрийте')}
                      <code> api.telegram.org/bot&lt;токен&gt;/getUpdates</code> {t('— id буде в полі')} <code>chat.id</code>.
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('Chat ID адміністраторів')}</label>
                    <input
                      className="form-input"
                      placeholder="123456789, 987654321"
                      value={adminIds}
                      onChange={(e) => setAdminIds(e.target.value)}
                    />
                    <div className="form-hint">{t('Через кому. Отримують копії заявок на підтвердження.')}</div>
                  </div>
                </div>

                {s.hasToken && (
                  <button className="btn btn-ghost" style={{ color: 'var(--accent-danger)' }} onClick={disconnect}>
                    <Unplug size={16} /> {t('Відключити')}
                  </button>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-title">{t('Події')}</div></div>
              <div style={{ padding: 20 }}>
                {EVENT_LABELS.map(({ key, label, hint }) => (
                  <label
                    key={key}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0',
                      borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={s.events[key]}
                      onChange={() => toggle(key)}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{hint}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
