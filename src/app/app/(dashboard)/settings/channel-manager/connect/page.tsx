'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { usePropertyScope } from '@/ui/PropertyScopeContext';
import PropertyRequired from '@/components/layout/PropertyRequired';
import { ArrowLeft, Check, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import Link from 'next/link';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Майстер підключення менеджера каналів.
 *
 * Стан кроку не живе тут: сторінка щоразу питає сервер, на якому кроці
 * майстер, і той виводить крок з того, що вже записано (ключ, зʼєднання,
 * обʼєкт на тому боці, увімкнення). Закрита вкладка посеред процесу — норма:
 * повторний вхід продовжує і не створює других сутностей у чужому акаунті.
 *
 * Ключ API ніколи не потрапляє в браузер назад: сервер віддає лише натяк
 * (`••••IqQq`). Адреса вбудованого вікна приходить із сервера з разовим
 * токеном, скутим там же; ця сторінка її не складає й не зберігає.
 *
 * Фініш — не «готово», а звірка: «N з N тарифів не змаплені на жоден канал».
 */

type Step = 'key' | 'connection' | 'catalog' | 'mapping' | 'done';

interface Setup {
  properties: { id: string; name: string }[];
  providers: { id: string; label: string }[];
  state: {
    property: { id: string; name: string } | null;
    hasKey: boolean;
    keyHint: string | null;
    connection: { id: string; provider: string; environment: string; remotePropertyId: string | null; isEnabled: boolean; lastFullSyncAt: string | null } | null;
  webhookRegistered: boolean;
    step: Step;
  } | null;
}

interface Reconciliation {
  total: number;
  channels: number;
  unmapped: { unitTypeCode: string; ratePlanCode: string }[];
  onlyInactive: { unitTypeCode: string; ratePlanCode: string }[];
  sellable: boolean;
}

const STEPS: Step[] = ['key', 'connection', 'catalog', 'mapping', 'done'];

export default function ConnectChannelManagerPage() {
  const tUi = useT();
  const onMenuClick = useMobileMenu();

  const [setup, setSetup] = useState<Setup | null>(null);
  // Обʼєкт — з області в шапці, не з власного стану (check-property-scope):
  // майстер заводить обʼєкт у чужому акаунті, і «перший-ліпший» тут — це
  // каталог не того готелю на тому боці.
  const { propertyId } = usePropertyScope();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'staging'>('production');
  const [catalogReport, setCatalogReport] = useState<any>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [webhookAttempt, setWebhookAttempt] = useState<{ registered: boolean; error?: string } | null>(null);
  const [webhookTest, setWebhookTest] = useState<{ statusCode: number; body: string } | null>(null);
  /** Повний синк (П5): план, прохід, розписки — з відповіді кнопки або ввімкнення. */
  const [fullSync, setFullSync] = useState<{
    plan: { from: string; to: string; unitTypes: number; pairs: number };
    flush: { sent: number; failed: number; calls: number; needsAttention: number };
    receipts: string[];
    completedAt: string | null;
  } | null>(null);

  const ERRORS: Record<string, string> = {
    module_disabled: tUi('Модуль каналів вимкнено для цього готелю'),
    invalid_key: tUi('Ключ не прийнято: менеджер каналів відповів «не авторизовано»'),
    vendor_unavailable: tUi('Менеджер каналів недоступний, спробуйте пізніше'),
    no_key: tUi('Спочатку збережіть ключ'),
    catalog_not_synced: tUi('Спочатку заведіть каталог'),
    key_required: tUi('Вставте ключ'),
    app_url_not_configured: tUi('Адресу сервера не налаштовано (APP_URL): вебхук зареєструвати нема куди'),
    webhook_inactive: tUi('Менеджер каналів тримає вебхук вимкненим'),
    webhook_not_registered: tUi('Спочатку зареєструйте вебхук'),
    unknown_provider: tUi('Невідомий провайдер зʼєднання'),
    connection_disabled: tUi('Спочатку ввімкніть розсилку'),
    full_sync_failed: tUi('Повний синк не вдався: координати повернулись у чергу, наступний прохід їх дошле'),
  };
  const explain = (code: string | undefined) => (code && ERRORS[code]) || tUi('Не вдалося. Спробуйте ще раз');

  const load = useCallback(async (pid: string | null) => {
    setLoading(true);
    try {
      if (!pid) { setSetup(null); return; }
      const res = await fetch(`/api/channels/setup?property_id=${encodeURIComponent(pid)}`);
      const body = await res.json();
      if (!res.ok) { setNotice({ kind: 'error', text: explain(body?.error) }); return; }
      setSetup(body);
      if (body.state?.connection?.environment) setEnvironment(body.state.connection.environment);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Інший обʼєкт — інший майстер: вікно мапінгу, звірка і звіт каталогу
    // належали попередньому (так робив селектор, який стояв тут).
    setFrameUrl(null); setReconciliation(null); setCatalogReport(null);
    load(propertyId);
  }, [propertyId, load]);

  const call = async (label: string, url: string, init: RequestInit, onOk: (body: any) => void | Promise<void>) => {
    setBusy(label);
    setNotice(null);
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ kind: 'error', text: explain(body?.error) }); return; }
      await onOk(body);
    } catch {
      setNotice({ kind: 'error', text: explain(undefined) });
    } finally {
      setBusy(null);
    }
  };

  const state = setup?.state ?? null;
  const provider = setup?.providers?.[0];
  const stepIndex = state ? STEPS.indexOf(state.step) : 0;
  const done = (s: Step) => STEPS.indexOf(s) < stepIndex;
  const active = (s: Step) => state?.step === s;

  const saveKey = () => call('key', '/api/channels/setup/key', {
    method: 'POST', body: JSON.stringify({ apiKey, provider: provider?.id, environment }),
  }, async () => { setApiKey(''); setNotice({ kind: 'ok', text: tUi('Ключ прийнято і збережено') }); await load(propertyId); });

  const createConnection = () => call('connection', '/api/channels/setup/connection', {
    method: 'POST', body: JSON.stringify({ propertyId, provider: provider?.id, environment }),
  }, async () => { setNotice({ kind: 'ok', text: tUi('Зʼєднання створено') }); await load(propertyId); });

  const syncCatalog = () => state?.connection && call('catalog', `/api/channels/connections/${state.connection.id}/catalog`, {
    method: 'POST',
  }, async (body) => { setCatalogReport(body); setNotice({ kind: 'ok', text: tUi('Каталог заведено') }); await load(propertyId); });

  const openFrame = () => state?.connection && call('frame', `/api/channels/connections/${state.connection.id}/frame?lng=${encodeURIComponent(document.documentElement.lang || 'en')}`, {
    method: 'GET',
  }, (body) => { setFrameUrl(body.url); });

  const reconcile = () => state?.connection && call('reconcile', `/api/channels/connections/${state.connection.id}/reconcile`, {
    method: 'GET',
  }, (body) => { setReconciliation(body); });

  const setEnabled = (enabled: boolean) => state?.connection && call('enabled', `/api/channels/connections/${state.connection.id}/enabled`, {
    method: 'POST', body: JSON.stringify({ enabled }),
  }, async (body) => {
    setWebhookAttempt(body?.webhook ?? null);
    setFullSync(body?.fullSync?.ok ? body.fullSync.report : null);
    setNotice(body?.fullSync && !body.fullSync.ok
      ? { kind: 'error', text: explain(body.fullSync.error) }
      : { kind: 'ok', text: enabled ? tUi('Розсилку ввімкнено') : tUi('Розсилку вимкнено') });
    await load(propertyId);
  });

  // ── Повний синк (П5): весь стан на 500 ночей двома викликами — рукою, ніколи за таймером ──
  const runFullSync = () => state?.connection && call('full-sync', `/api/channels/connections/${state.connection.id}/full-sync`, {
    method: 'POST',
  }, async (body) => {
    setFullSync(body);
    setNotice(body?.completedAt ? { kind: 'ok', text: tUi('Повний синк відправлено') } : { kind: 'error', text: explain('full_sync_failed') });
    await load(propertyId);
  });

  // ── Вебхук: сигнал, не дані (Ц20) ──
  const ensureWebhook = () => state?.connection && call('webhook', `/api/channels/connections/${state.connection.id}/webhook`, {
    method: 'POST',
  }, async (body) => {
    setWebhookAttempt(body);
    setNotice(body?.registered ? { kind: 'ok', text: tUi('Вебхук зареєстровано') } : { kind: 'error', text: explain(body?.error) });
    await load(propertyId);
  });
  const testWebhook = () => state?.connection && call('webhook-test', `/api/channels/connections/${state.connection.id}/webhook/test`, {
    method: 'POST',
  }, (body) => { setWebhookTest(body); });
  const rotateSecret = () => state?.connection && call('webhook-rotate', `/api/channels/connections/${state.connection.id}/webhook/rotate`, {
    method: 'POST',
  }, () => { setNotice({ kind: 'ok', text: tUi('Секрет замінено') }); });
  const disconnect = () => {
    if (!state?.connection) return;
    if (!window.confirm(tUi('Відʼєднати: вебхук у менеджера каналів буде прибрано, розсилку вимкнено. Прийняті броні лишаються.'))) return;
    void call('disconnect', `/api/channels/connections/${state.connection.id}/disconnect`, { method: 'POST' }, async () => {
      setWebhookAttempt(null);
      setWebhookTest(null);
      setNotice({ kind: 'ok', text: tUi('Відʼєднано') });
      await load(propertyId);
    });
  };

  const StepHeader = ({ step, n, title }: { step: Step; n: number; title: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{
        width: 26, height: 26, borderRadius: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: done(step) ? 'var(--accent-success)' : active(step) ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
        color: done(step) || active(step) ? '#fff' : 'var(--text-tertiary)', fontSize: 13, fontWeight: 700,
      }}>{done(step) ? <Check size={14} /> : n}</span>
      <h3 style={{ margin: 0 }}>{title}</h3>
    </div>
  );

  return (
    <>
      <Header title={tUi('Підключення менеджера каналів')} onMenuClick={onMenuClick} />
      <div className="app-content">
        <div className="page-header">
          <div>
            <Link href="/app/settings/channel-manager" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 4, textDecoration: 'none' }}>
              <ArrowLeft size={14} /> {tUi('Канал-менеджер')}
            </Link>
            <h2 className="page-title">{tUi('Підключення менеджера каналів')}</h2>
            <div className="page-subtitle">{tUi('Пʼять кроків. Закрили вкладку — повернулись і продовжили з того ж місця')}</div>
          </div>
        </div>

        {notice && (
          <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${notice.kind === 'ok' ? 'var(--accent-success)' : 'var(--accent-danger)'}` }}>
            {notice.text}
          </div>
        )}

        <PropertyRequired>
        {loading && !setup ? (
          <div style={{ textAlign: 'center', padding: 64 }}><Loader2 size={24} className="animate-pulse" style={{ display: 'inline-block' }} /></div>
        ) : !setup ? null : (
          <>
            {/* ── Обʼєкт ── обирається в шапці; тут лише названо, з яким працюємо */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>{tUi('Обʼєкт')}</div>
              <div style={{ fontWeight: 600 }}>{state?.property?.name ?? setup.properties.find((p) => p.id === propertyId)?.name ?? '—'}</div>
              {provider && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>{tUi('Провайдер')}: {provider.label}</div>}
            </div>

            {/* ── 1. Ключ ── */}
            <div className="card" style={{ marginBottom: 16 }}>
              <StepHeader step="key" n={1} title={tUi('Ключ API менеджера каналів')} />
              {state?.hasKey ? (
                <div style={{ fontSize: 13 }}>{tUi('Ключ збережено')}: <code>{state.keyHint}</code></div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
                  {tUi('Ключ належить вашому готелю: кабінет менеджера каналів → Profile → API key. Він перевіряється одним запитом одразу після вставки')}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <input className="input" type="password" autoComplete="off" placeholder={state?.hasKey ? tUi('Замінити ключ') : tUi('Вставте ключ')}
                  value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
                <select className="input" value={environment} onChange={(e) => setEnvironment(e.target.value as 'production' | 'staging')} style={{ width: 200 }}
                  disabled={Boolean(state?.connection)}>
                  <option value="production">{tUi('бойове середовище')}</option>
                  <option value="staging">{tUi('тестове середовище (staging)')}</option>
                </select>
                <button className="btn btn-primary" disabled={!apiKey || busy === 'key'} onClick={saveKey}>
                  {busy === 'key' ? <Loader2 size={14} className="animate-pulse" /> : null} {tUi('Перевірити й зберегти')}
                </button>
              </div>
            </div>

            {/* ── 2. Зʼєднання ── */}
            <div className="card" style={{ marginBottom: 16, opacity: state?.hasKey ? 1 : 0.5 }}>
              <StepHeader step="connection" n={2} title={tUi('Зʼєднання обʼєкта')} />
              {state?.connection ? (
                <div style={{ fontSize: 13 }}>
                  {state.connection.provider} · {state.connection.environment} · {state.connection.isEnabled ? tUi('увімкнено') : tUi('вимкнено')}
                </div>
              ) : (
                <button className="btn btn-primary" disabled={!state?.hasKey || busy === 'connection'} onClick={createConnection}>
                  {tUi('Створити зʼєднання')}
                </button>
              )}
            </div>

            {/* ── 3. Каталог ── */}
            <div className="card" style={{ marginBottom: 16, opacity: state?.connection ? 1 : 0.5 }}>
              <StepHeader step="catalog" n={3} title={tUi('Каталог: типи номерів і тарифи')} />
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
                {tUi('Заводить у менеджері каналів лише те, чого там ще немає. Тарифи створюються закритими: продаж відкриє перша розсилка цін')}
              </div>
              <button className="btn btn-primary" disabled={!state?.connection || busy === 'catalog'} onClick={syncCatalog}>
                {busy === 'catalog' ? <Loader2 size={14} className="animate-pulse" /> : <RefreshCw size={14} />} {state?.connection?.remotePropertyId ? tUi('Оновити каталог') : tUi('Завести каталог')}
              </button>
              {catalogReport && (
                <div style={{ fontSize: 12, marginTop: 8 }}>
                  {tUi('створено')}: {catalogReport.created?.unitTypes} / {catalogReport.created?.ratePlans} · {tUi('вже було')}: {catalogReport.existing?.unitTypes} / {catalogReport.existing?.ratePlans}
                  {catalogReport.skipped?.length > 0 && <> · {tUi('пропущено')}: {catalogReport.skipped.map((s: any) => `${s.localId} (${s.reason})`).join(', ')}</>}
                </div>
              )}
            </div>

            {/* ── 4. Мапінг у вікні вендора ── */}
            <div className="card" style={{ marginBottom: 16, opacity: state?.connection?.remotePropertyId ? 1 : 0.5 }}>
              <StepHeader step="mapping" n={4} title={tUi('Мапінг на канали')} />
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
                {tUi('Підключення до Booking.com, Airbnb та інших і мапінг тарифів робляться у вікні менеджера каналів. Вікно відкривається разовим ключем на 15 хвилин; мова вікна — англійська або німецька')}
              </div>
              <button className="btn" disabled={!state?.connection?.remotePropertyId || busy === 'frame'} onClick={openFrame}>
                <ExternalLink size={14} /> {frameUrl ? tUi('Відкрити знову') : tUi('Відкрити вікно мапінгу')}
              </button>
              {frameUrl && (
                <iframe
                  key={frameUrl}
                  src={frameUrl}
                  title={tUi('Мапінг на канали')}
                  referrerPolicy="no-referrer"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
                  style={{ width: '100%', height: '78vh', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', marginTop: 12, background: '#fff' }}
                />
              )}
            </div>

            {/* ── 5. Звірка і ввімкнення ── */}
            <div className="card" style={{ marginBottom: 16, opacity: state?.connection?.remotePropertyId ? 1 : 0.5 }}>
              <StepHeader step="done" n={5} title={tUi('Звірка: що справді продається')} />
              <button className="btn" disabled={!state?.connection?.remotePropertyId || busy === 'reconcile'} onClick={reconcile}>
                {busy === 'reconcile' ? <Loader2 size={14} className="animate-pulse" /> : <RefreshCw size={14} />} {tUi('Звірити з менеджером каналів')}
              </button>
              {reconciliation && (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, color: reconciliation.unmapped.length ? 'var(--accent-warning)' : 'var(--accent-success)' }}>
                    {reconciliation.unmapped.length} {tUi('з')} {reconciliation.total} {tUi('тарифів не змаплені на жоден канал')}
                  </div>
                  <div style={{ color: 'var(--text-tertiary)' }}>{tUi('Каналів у обʼєкта')}: {reconciliation.channels}</div>
                  {reconciliation.unmapped.length > 0 && (
                    <ul style={{ margin: '6px 0 0 18px' }}>
                      {reconciliation.unmapped.map((p, i) => <li key={i}>{p.ratePlanCode} × {p.unitTypeCode}</li>)}
                    </ul>
                  )}
                  {reconciliation.onlyInactive.length > 0 && (
                    <div style={{ marginTop: 6, color: 'var(--accent-warning)' }}>
                      {reconciliation.onlyInactive.length} {tUi('лише на вимкнених каналах')}: {reconciliation.onlyInactive.map((p) => `${p.ratePlanCode} × ${p.unitTypeCode}`).join(', ')}
                    </div>
                  )}
                </div>
              )}
              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {state?.connection?.isEnabled ? (
                  <button className="btn" disabled={busy === 'enabled'} onClick={() => setEnabled(false)}>{tUi('Вимкнути розсилку')}</button>
                ) : (
                  <button className="btn btn-primary" disabled={!state?.connection?.remotePropertyId || busy === 'enabled'} onClick={() => setEnabled(true)}>{tUi('Увімкнути розсилку')}</button>
                )}
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {tUi('Розсилка наявності й цін іде щохвилини лише для ввімкненого зʼєднання. Тариф, не змаплений на канал, нікуди не продається')}
                </span>
              </div>

              {/* ── Повний синк (П5): весь стан на 500 ночей двома викликами — рукою або при ввімкненні, ніколи за таймером (И6, Ц23). ── */}
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border-color)', paddingTop: 10, fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>
                  {tUi('Повний синк')}: {state?.connection?.lastFullSyncAt ? new Date(state.connection.lastFullSyncAt).toLocaleString() : tUi('ще не робився')}
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-sm" disabled={!state?.connection?.isEnabled || busy === 'full-sync'} onClick={runFullSync}>
                    {busy === 'full-sync' ? <Loader2 size={14} className="animate-pulse" /> : <RefreshCw size={14} />} {tUi('Повний синк (500 ночей)')}
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {tUi('Весь стан на 500 ночей уперед — наявність, ціни й обмеження — двома викликами, по одному на смугу. Робиться при ввімкненні розсилки й цією кнопкою; за таймером — ніколи')}
                  </span>
                </div>
                {fullSync && (
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    {tUi('у чергу')}: {fullSync.plan.unitTypes} {tUi('типів')} · {fullSync.plan.pairs} {tUi('пар тип × тариф')} · {fullSync.plan.from} – {fullSync.plan.to}
                    {' · '}{tUi('викликів')}: {fullSync.flush.calls} · {tUi('відправлено')}: {fullSync.flush.sent} · {tUi('повернуто')}: {fullSync.flush.failed}
                    {' · '}task id: <code style={{ userSelect: 'all' }}>{fullSync.receipts.join(', ') || '—'}</code>
                    {' · '}{fullSync.completedAt ? tUi('завершено') : tUi('не завершено: щось повернулось у чергу')}
                  </div>
                )}
              </div>

              {/* ── Вебхук: сигнал, не дані (Ц20). Без нього бронь з каналу чекає на плановий прохід, а це вікно овербукінгу. ── */}
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border-color)', paddingTop: 10, fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: state?.webhookRegistered ? 'var(--accent-success)' : 'var(--accent-warning)' }}>
                  {state?.webhookRegistered
                    ? tUi('Вебхук зареєстровано: бронь з каналу будить опитування одразу')
                    : tUi('Вебхук не зареєстровано: бронь з каналу чекає на плановий прохід')}
                </div>
                {webhookAttempt && !webhookAttempt.registered && (
                  <div style={{ color: 'var(--accent-warning)' }}>{explain(webhookAttempt.error)}</div>
                )}
                {webhookTest && (
                  <div>{tUi('Пробна доставка')}: {tUi('менеджер каналів отримав від нашого сервера код')} <strong>{webhookTest.statusCode}</strong></div>
                )}
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm" disabled={!state?.connection?.remotePropertyId || busy === 'webhook'} onClick={ensureWebhook}>
                    {state?.webhookRegistered ? tUi('Перевірити реєстрацію') : tUi('Зареєструвати вебхук')}
                  </button>
                  <button className="btn btn-sm" disabled={!state?.webhookRegistered || busy === 'webhook-test'} onClick={testWebhook}>{tUi('Пробна доставка')}</button>
                  <button className="btn btn-sm" disabled={!state?.webhookRegistered || busy === 'webhook-rotate'} onClick={rotateSecret}>{tUi('Замінити секрет')}</button>
                  <button className="btn btn-sm" disabled={!state?.connection || busy === 'disconnect'} onClick={disconnect}>{tUi('Відʼєднати')}</button>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {tUi('Вебхук — сигнал, не дані: він лише каже «опитай стрічку зараз». Плановий прохід стрічки не вимикається')}
                </span>
              </div>
            </div>
          </>
        )}
        </PropertyRequired>
      </div>
    </>
  );
}
