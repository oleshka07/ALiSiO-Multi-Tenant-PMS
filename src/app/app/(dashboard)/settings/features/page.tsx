'use client';

import { useT } from '@core/i18n/client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import { APPS } from '@core/apps';
import { notifyCurrentUserChanged } from '@/ui/hooks/useCurrentUser';

/**
 * «Модулі» — що ввімкнено у вашому готелі. Owner-only: the API refuses everyone else.
 *
 * ── Що звідси пішло (Блок «Застосунки», 09.09.2026) ──────────────────────
 *
 * Цей екран звався «Модулі та інтеграції» і показував усі ключі реєстру одним
 * списком, а під ними мав показувати поля ключів вендора. Полів насправді не
 * бачив ніхто: вони шукались за ключем реєстру (`fiscal_de`) у мапі,
 * ключованій каналом (`fiskaly`). Тепер ключі вендора, стан звʼязку і «скоро»
 * живуть на екрані «Застосунки» (`/app/settings/apps`), а тут — лише ядро й
 * модулі PMS: `kind: 'core' | 'module'`.
 *
 * Який ключ — застосунок, каже реєстр застосунків: ключ, який стереже хоч
 * один запис `APPS`, тут не показується. Гейт `apps.check.ts` тримає, що це
 * рівно ключі з `kind: 'app'` у реєстрі фіч — тобто екран не вгадує, а читає.
 */
const APP_FEATURES = new Set(APPS.map((a) => a.feature).filter((f): f is NonNullable<typeof f> => !!f));

/**
 * Людські назви функцій, які кличуть модель.
 *
 * Ключ приходить із бази рядком (`ai_usage.feature`), і незнайомий показується
 * як є: наступна функція з моделлю не має вимагати правки цього файлу, щоб
 * зʼявитись у лічильнику.
 */
const AI_FEATURE_LABEL: Record<string, string> = {
  ocr_document: 'Розпізнавання документів',
  translate_content: 'Переклад контенту',
};

interface AiUsage {
  month: string;
  totalTokens: number;
  byFeature: { feature: string; model: string; tokens: number; calls: number }[];
}

export default function FeaturesSettingsPage() {
  const t = useT();
  const [catalog, setCatalog] = useState<Record<string, string>>({});
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [ai, setAi] = useState<AiUsage | null>(null);

  useEffect(() => {
    fetch('/api/settings/features')
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'Доступно лише власнику' : 'Не вдалося завантажити');
        return r.json();
      })
      .then((d) => { setCatalog(d.catalog); setFeatures(d.features); })
      // Лічильник — не частина завантаження екрана: якщо він не відповість,
      // перемикачі мусять зʼявитись усе одно.
      .then(() => fetch('/api/settings/ai-usage')
        .then((r) => (r.ok ? r.json() : null))
        .then(setAi)
        .catch(() => {}))
      .catch((e) => setError(t(e.message)))
      .finally(() => setLoading(false));
  }, [t]);

  const toggle = async (feature: string) => {
    setBusy(feature);
    try {
      const res = await fetch('/api/settings/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature, enabled: !features[feature] }),
      });
      if (res.ok) {
        setFeatures((await res.json()).features);
        // Цей екран — не єдиний, хто живе за ключами модулів: за ними ховається
        // пункт меню, закривається розділ, зникає рядок у пошуку Ctrl+K.
        // `setFeatures` вище оновив лише цю сторінку — решта копій
        // `useCurrentUser` досі тримають те, що прочитали при монтуванні.
        notifyCurrentUserChanged();
      }
    } finally {
      setBusy('');
    }
  };

  const line = '1px solid var(--border-color)';
  const modules = Object.entries(catalog).filter(([key]) => !APP_FEATURES.has(key as never));

  return (
    <>
      <div className="app-content">
        <div className="page-header">
          <div>
            <Link href="/app/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-tertiary)', textDecoration: 'none', marginBottom: 8 }}>
              <ArrowLeft size={14} /> {t('Налаштування')}
            </Link>
            <h2 className="page-title">{t('Модулі')}</h2>
            <div className="page-subtitle">{t('Вимкнене тут зникає з меню і перестає відповідати на запити')}</div>
          </div>
        </div>

        {loading && <Loader2 className="animate-spin" size={20} />}
        {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}

        {!loading && (
          <div className="card" data-testid="modules-list" style={{ maxWidth: 640, padding: 0 }}>
            {modules.map(([key, label], i) => (
              <div key={key} data-testid={`module-${key}`} style={{ borderTop: i ? line : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{t(label)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{key}</div>
                  </div>
                  <button
                    onClick={() => toggle(key)}
                    disabled={busy === key}
                    aria-label={`${features[key] ? t('Вимкнути') : t('Увімкнути')} ${t(label)}`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: features[key] ? 'var(--success)' : 'var(--text-tertiary)' }}
                  >
                    {features[key] ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                  </button>
                </div>
              </div>
            ))}
            <div style={{ borderTop: line, padding: '12px 20px', fontSize: 12, color: 'var(--text-tertiary)' }}>
              {t('Фіскалізація, онлайн-оплата, пошта та інші звʼязки з чужими системами — на екрані')}{' '}
              <Link href="/app/settings/apps">{t('Застосунки')}</Link>
            </div>
          </div>
        )}

        {/*
          Скільки токенів моделі витратив цей готель.

          Ключ OpenAI серверний і спільний на всіх клієнтів, тож рахунок від
          постачальника приходить один — а витрачають його різні готелі. Тут
          видно, хто скільки, у розрізі функцій.

          Число в токенах, а не в грошах, і це рішення, а не незакінченість:
          тарифу підписки поки немає, і назвати суму раніше за нього означало б
          назвати ціну, якої ніхто не погоджував. Коли зʼявиться екран білінгу,
          ці самі дані переїдуть туди.
        */}
        {!loading && ai && (
          <div className="card" style={{ maxWidth: 640, marginTop: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              {t('Витрачено токенів AI')} · {ai.month}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
              {t('Розпізнавання документів і машинний переклад контенту йдуть ключем сервісу. Тарифікація зʼявиться разом із підпискою.')}
            </div>

            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)' }}>
              {ai.totalTokens.toLocaleString()}
            </div>

            {ai.byFeature.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
                {t('Цього місяця AI не використовувався')}
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                {ai.byFeature.map((row) => (
                  <div key={`${row.feature}-${row.model}`}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderTop: line, fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {t(AI_FEATURE_LABEL[row.feature] || row.feature)}
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: 8, fontSize: 11 }}>{row.model}</span>
                    </span>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      {row.tokens.toLocaleString()}
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: 8, fontSize: 11 }}>
                        · {row.calls} {t('викл.')}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
