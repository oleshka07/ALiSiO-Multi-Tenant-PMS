'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/State';
import { ArrowLeft, RefreshCw, Loader2, ExternalLink, AlertCircle, Clock } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Канали (OTA) — рівень, якого досі не було.
 *
 * ── Що це відповідає ────────────────────────────────────────────────────
 *
 * «Що з нашого фонду і КУДИ продається». Досі відповіді не було: `cm_mappings`
 * каже лише «наша пара тип × тариф = ось цей тариф у менеджера каналів», а
 * який OTA той тариф побачить, вирішують мапінг-айтеми всередині вендора.
 * Ц8 закривав це інструкцією готельєру — «зайдіть і не мапте цей тариф на
 * Booking». Тут воно стало числом.
 *
 * ── Три розділи, як у Hoteliera ─────────────────────────────────────────
 *
 * Підключені · У налаштуванні · Доступні. Різниця між першими двома не
 * косметична: підключений і УВІМКНЕНИЙ канал продає, підключений і вимкнений
 * не продає нічого — а виглядають вони однаково, якщо звалити в один список.
 *
 * ── Чого тут немає навмисно ─────────────────────────────────────────────
 *
 * Кнопки «підключити» і «змапити». Мапінг у кожного OTA свій, і писати його
 * з нашого боку — ЧЕКПОІНТ рецензента (К2): спершу живий вимір по одному
 * OTA. Доти кнопка веде у вбудоване вікно вендора (Ц19), де готельєр це й
 * робить.
 *
 * Дані — з дзеркала, а не з вендора на кожне відкриття: «Оновити» питає його
 * не частіше разу на годину, і вік дзеркала показаний поруч. Порожній екран
 * тут означає «ще не питали», і він каже це, а не «каналів не буває».
 */

interface Pair {
  ratePlanId: string;
  unitTypeId: string;
  ratePlanCode: string;
  unitTypeCode: string;
}

interface ChannelRow {
  remoteChannelId: string;
  otaCode: string;
  title: string;
  isActive: boolean;
  pairs: Pair[];
  foreignRatePlans: number;
}

interface CatalogRow { code: string; title: string; kind: string; messaging: boolean }

interface Snapshot {
  channels: ChannelRow[];
  catalog: CatalogRow[];
  syncedAt: string | null;
  ageMs: number | null;
  staleAfterMs: number;
  totalPairs: number;
  unmapped: Pair[];
  onlyInactive: Pair[];
  provider?: string;
  skipped?: string[];
  error?: string;
  retryAfterMs?: number;
}

interface Connection { id: string; provider: string; environment: string; isEnabled: boolean; remotePropertyId: string | null }

export default function ChannelsPage() {
  const tUi = useT();
  const onMenuClick = useMobileMenu();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/channels/connections');
        if (!res.ok) { setFailed(res.status === 409 ? 'module_disabled' : String(res.status)); return; }
        const list = await res.json();
        setConnections(list);
        if (list.length) setCurrent(list[0].id);
      } catch { setFailed('network'); } finally { setLoading(false); }
    })();
  }, []);

  const load = useCallback(async (connectionId: string) => {
    setLoading(true); setFailed(null);
    try {
      const res = await fetch(`/api/channels/connections/${connectionId}/channels`);
      if (!res.ok) { setFailed(String(res.status)); return; }
      setData(await res.json());
    } catch { setFailed('network'); } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (current) void load(current); }, [current, load]);

  /** «Оновити»: спитати вендора. Занадто рано — 429 із тим, що вже є. */
  const refresh = useCallback(async (force: boolean) => {
    if (!current) return;
    setBusy(true); setNote(null);
    try {
      const res = await fetch(`/api/channels/connections/${current}/channels${force ? '?force=1' : ''}`, { method: 'POST' });
      const body = await res.json();
      if (res.status === 429) {
        // Не помилка: дзеркало свіже, вендора питати рано. Показуємо те, що
        // прийшло разом із відмовою, і кажемо, коли можна.
        setData(body);
        setNote(tUi('Дзеркало свіже — вендора можна питати не частіше разу на годину'));
        return;
      }
      if (!res.ok) { setNote(errorText(body?.error)); return; }
      setData(body);
      if (body.skipped?.length) setNote(`${tUi('Не вдалося прочитати каналів')}: ${body.skipped.length}`);
    } catch { setNote(tUi('Не вдалося звʼязатися з сервером')); } finally { setBusy(false); }
  }, [current, tUi]);

  const errorText = (code?: string) => {
    if (code === 'module_disabled') return tUi('Модуль каналів не підключено');
    if (code === 'no_key') return tUi('Ключ менеджера каналів не збережено');
    if (code === 'catalog_not_synced') return tUi('Каталог ще не заведено в менеджері каналів');
    if (code === 'unknown_provider') return tUi('Невідомий менеджер каналів');
    return tUi('Не вдалося оновити');
  };

  const openFrame = useCallback(async () => {
    if (!current) return;
    try {
      const res = await fetch(`/api/channels/connections/${current}/frame`);
      if (!res.ok) { setNote(errorText((await res.json())?.error)); return; }
      const { url } = await res.json();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch { setNote(tUi('Не вдалося відкрити вікно мапінгу')); }
  }, [current, tUi]);

  const connected = (data?.channels ?? []).filter((c) => c.isActive);
  const inSetup = (data?.channels ?? []).filter((c) => !c.isActive);
  const connectedCodes = new Set((data?.channels ?? []).map((c) => c.otaCode));
  const available = (data?.catalog ?? []).filter((c) => !connectedCodes.has(c.code));

  const age = () => {
    if (!data?.syncedAt) return tUi('ще не питали');
    const ms = data.ageMs ?? 0;
    const minutes = Math.max(0, Math.round(ms / 60000));
    if (minutes < 1) return tUi('щойно');
    if (minutes < 60) return `${minutes} ${tUi('хв тому')}`;
    return `${Math.round(minutes / 60)} ${tUi('год тому')}`;
  };

  return (
    <>
      <Header title={tUi('Канали (OTA)')} onMenuClick={onMenuClick} />
      <div className="app-content">
        <div className="page-header">
          <div>
            <Link href="/app/settings/channel-manager" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 4, textDecoration: 'none' }}>
              <ArrowLeft size={14} /> {tUi('Канал-менеджер')}
            </Link>
            <h2 className="page-title">{tUi('Канали (OTA)')}</h2>
            <div className="page-subtitle">{tUi('Куди саме продається кожна пара «тип номера × тариф»')}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {connections.length > 1 && (
              <select className="input" value={current ?? ''} onChange={(e) => setCurrent(e.target.value)} style={{ width: 'auto' }}>
                {connections.map((c) => <option key={c.id} value={c.id}>{c.provider} · {c.environment}</option>)}
              </select>
            )}
            <button className="btn btn-sm" disabled={busy || !current} onClick={() => void refresh(false)}>
              {busy ? <Loader2 size={14} className="animate-pulse" /> : <RefreshCw size={14} />} {tUi('Оновити')}
            </button>
            <button className="btn btn-sm btn-primary" disabled={!current} onClick={() => void openFrame()}>
              <ExternalLink size={14} /> {tUi('Відкрити мапінг у вендора')}
            </button>
          </div>
        </div>

        {note && (
          <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--accent-warning)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><AlertCircle size={16} /> {note}</span>
              <button className="btn btn-sm" disabled={busy} onClick={() => void refresh(true)}>{tUi('Все одно оновити')}</button>
            </div>
          </div>
        )}

        {loading && <LoadingState label={tUi('Читаємо дзеркало каналів')} />}
        {!loading && failed === 'module_disabled' && (
          <EmptyState title={tUi('Модуль каналів не підключено')} hint={tUi('Канали — платний модуль; увімкніть його в налаштуваннях організації')} />
        )}
        {!loading && failed && failed !== 'module_disabled' && (
          <ErrorState title={tUi('Не вдалося прочитати канали')} retry={() => current && void load(current)} />
        )}
        {!loading && !failed && connections.length === 0 && (
          <EmptyState
            title={tUi('Менеджер каналів не підключено')}
            hint={tUi('Спершу підключіть менеджер каналів — тоді тут зʼявляться OTA')}
            action={{ label: tUi('Підключити'), href: '/app/settings/channel-manager/connect' }}
          />
        )}

        {!loading && !failed && data && connections.length > 0 && (
          <>
            <div className="page-subtitle" style={{ marginBottom: 16, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Clock size={14} /> {tUi('Дзеркало оновлено')}: {age()}
              {data.ageMs !== null && data.ageMs > data.staleAfterMs && (
                <span style={{ color: 'var(--accent-warning)' }}> · {tUi('застаріле')}</span>
              )}
            </div>

            {/* ── Звірка Ц8: те, що заведено і нікуди не продається ── */}
            {(data.unmapped.length > 0 || data.onlyInactive.length > 0) && (
              <div className="card" style={{ marginBottom: 24, borderLeft: '3px solid var(--accent-warning)' }}>
                <h3 style={{ marginTop: 0, marginBottom: 4 }}>{tUi('Заведено, але не продається')}</h3>
                <div className="page-subtitle" style={{ marginBottom: 8 }}>
                  {tUi('Тариф, створений у менеджері каналів, ще не продається: це різні хвороби і лікуються по-різному')}
                </div>
                {data.unmapped.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <strong>{data.unmapped.length} {tUi('з')} {data.totalPairs}</strong>{' '}
                    {tUi('не змаплено на жоден канал — відкрийте вікно мапінгу')}
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                      {data.unmapped.slice(0, 12).map((p) => `${p.ratePlanCode} × ${p.unitTypeCode}`).join(', ')}
                      {data.unmapped.length > 12 ? ' …' : ''}
                    </div>
                  </div>
                )}
                {data.onlyInactive.length > 0 && (
                  <div>
                    <strong>{data.onlyInactive.length}</strong>{' '}
                    {tUi('змаплено лише на вимкнені канали — увімкніть канал')}
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                      {data.onlyInactive.slice(0, 12).map((p) => `${p.ratePlanCode} × ${p.unitTypeCode}`).join(', ')}
                      {data.onlyInactive.length > 12 ? ' …' : ''}
                    </div>
                  </div>
                )}
              </div>
            )}

            <Section title={tUi('Підключені')} hint={tUi('Обмінюються даними — те, що тут, продається зараз')} rows={connected} tUi={tUi} />
            <Section title={tUi('У налаштуванні')} hint={tUi('Підключення створене, але вимкнене: дані в канал не йдуть')} rows={inSetup} tUi={tUi} />

            <div className="card">
              <h3 style={{ marginTop: 0, marginBottom: 4 }}>{tUi('Доступні')}</h3>
              <div className="page-subtitle" style={{ marginBottom: 8 }}>
                {tUi('Канали, які підтримує менеджер каналів; підключення робиться в його вікні')}
              </div>
              {available.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                  {data.catalog.length === 0
                    ? tUi('Перелік ще не читали — натисніть «Оновити»')
                    : tUi('Усі доступні канали вже підключені')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {available.map((c) => (
                    <span key={c.code} className="badge" style={{ fontSize: 12 }}>
                      {c.title}
                      <span style={{ color: 'var(--text-tertiary)' }}> · {c.kind}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Один розділ списку каналів. Порожній розділ каже, що він порожній. */
function Section({ title, hint, rows, tUi }: { title: string; hint: string; rows: ChannelRow[]; tUi: (s: string) => string }) {
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>{title} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>· {rows.length}</span></h3>
      <div className="page-subtitle" style={{ marginBottom: 8 }}>{hint}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{tUi('Порожньо')}</div>
      ) : rows.map((c) => (
        <div key={c.remoteChannelId} style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12, marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong>{c.title || c.otaCode}</strong>
              {/* Код поруч із назвою навмисно: назву готельєр міняє, код — ні,
                  і зіставляти вендор просить саме за кодом. */}
              <span style={{ color: 'var(--text-tertiary)' }}> · {c.otaCode}</span>
            </div>
            <span style={{ fontSize: 12, color: c.isActive ? 'var(--accent-success)' : 'var(--text-tertiary)' }}>
              {c.isActive ? tUi('активний') : tUi('вимкнений')}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
            {c.pairs.length === 0
              ? tUi('Жодної нашої пари — на цей канал нічого не змаплено')
              : `${tUi('Продається')}: ${c.pairs.map((p) => `${p.ratePlanCode} × ${p.unitTypeCode}`).join(', ')}`}
            {c.foreignRatePlans > 0 && (
              <span style={{ color: 'var(--accent-warning)' }}>
                {' · '}{c.foreignRatePlans} {tUi('тариф(ів) каналу — не з нашого каталогу')}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
