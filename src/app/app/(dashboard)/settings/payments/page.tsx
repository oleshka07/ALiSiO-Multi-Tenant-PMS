'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, CreditCard, Loader2, ShieldAlert } from 'lucide-react';

/**
 * Which payment gateway this hotel uses.
 *
 * The screen a «підключити онлайн-оплату» button leads to, from every place in
 * the product where money could be taken online and cannot be.
 *
 * It says the same thing at the top, once, and does not repeat it per card:
 * no gateway is written yet. A hotel may still choose its provider and save
 * its keys — that is the part that needs the hotel's own account and its own
 * decision, and doing it now means the day the gateway ships there is nothing
 * left to do. What it must never do is imply that saving keys turned payments
 * on. `anyLive` from the API decides that wording, not this file.
 *
 * Owner-only, like every other key screen: the API refuses everyone else.
 */

interface FieldSpec { field: string; label: string; hint?: string }
interface Provider {
  id: string;
  label: string;
  note: string;
  where: string;
  live: boolean;
  fields: FieldSpec[];
  values: Record<string, string | null>;
  configured: boolean;
}

export default function PaymentsSettingsPage() {
  const t = useT();
  const [enabled, setEnabled] = useState(false);
  const [anyLive, setAnyLive] = useState(false);
  const [secretsOk, setSecretsOk] = useState(true);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [open, setOpen] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/payments');
    if (!res.ok) {
      setError(t(res.status === 403 ? 'Доступно лише власнику' : 'Не вдалося завантажити'));
      return;
    }
    const d = await res.json();
    setEnabled(d.enabled);
    setAnyLive(d.anyLive);
    setSecretsOk(d.secretsConfigured);
    setProviders(d.providers);
  }, [t]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const turnOn = async () => {
    setBusy('feature');
    try {
      const res = await fetch('/api/settings/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature: 'online_payments', enabled: !enabled }),
      });
      if (res.ok) await load();
      else setError(t('Не вдалося змінити налаштування'));
    } finally { setBusy(''); }
  };

  const save = async (id: string) => {
    setBusy(id);
    setError('');
    try {
      const res = await fetch('/api/settings/payments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: id, values: drafts[id] || {} }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || t('Не вдалося зберегти'));
        return;
      }
      setDrafts((prev) => ({ ...prev, [id]: {} }));
      await load();
      setSaved(id);
      setTimeout(() => setSaved(''), 2500);
    } finally { setBusy(''); }
  };

  return (
    <>
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
        <Link href="/app/settings" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeft size={16} /> {t('Налаштування')}
        </Link>

        {/* The one claim this page makes about itself, made once and first. */}
        {!anyLive && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert size={20} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-100 space-y-2">
                <p className="font-semibold">{t('Приймання оплат ще не працює')}</p>
                <p>
                  {t('Жоден шлюз поки не під\'єднаний до коду — списати картку продукт сьогодні не вміє. Оберіть свого провайдера і збережіть ключі: це та частина, яка потребує вашого акаунта й вашого рішення. Коли шлюз буде готовий, приймання ввімкнеться на цих самих ключах.')}
                </p>
                <p className="text-amber-200/80">
                  {t('Поки цього не сталося, гість бачить у віджеті оплату на місці або рахунок — і жодної кнопки, яка нікуди не веде.')}
                </p>
              </div>
            </div>
          </div>
        )}

        {!secretsOk && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
            {t('APP_SECRET_KEY не налаштовано на сервері — ключі нема куди зашифрувати, тож збереження буде відхилено.')}
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">{t('Модуль онлайн-оплати')}</div>
            <div className="text-sm text-gray-400">
              {enabled ? t('Увімкнено — можна зберігати ключі провайдера') : t('Вимкнено — увімкніть, щоб обрати провайдера')}
            </div>
          </div>
          <button
            onClick={turnOn}
            disabled={busy === 'feature'}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${enabled ? 'bg-white/10 hover:bg-white/20' : 'bg-emerald-600 hover:bg-emerald-500'}`}
          >
            {busy === 'feature' ? <Loader2 size={16} className="animate-spin" /> : enabled ? t('Вимкнути') : t('Увімкнути')}
          </button>
        </div>

        {error && <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-200">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-500" /></div>
        ) : (
          <div className="space-y-3">
            {providers.map((p) => (
              <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                <button
                  onClick={() => setOpen(open === p.id ? '' : p.id)}
                  disabled={!enabled}
                  className="w-full flex items-center gap-3 p-4 text-left disabled:opacity-50"
                >
                  <CreditCard size={18} className="text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium flex items-center gap-2">
                      {p.label}
                      {p.configured && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
                          {t('ключі збережено')}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-400 truncate">{t(p.note)}</div>
                  </div>
                  <span className="text-sm text-gray-500 shrink-0">{open === p.id ? '−' : '+'}</span>
                </button>

                {open === p.id && (
                  <div className="border-t border-white/10 p-4 space-y-3">
                    <p className="text-xs text-gray-500">{t('Де взяти:')} {p.where}</p>
                    {p.fields.map((f) => (
                      <label key={f.field} className="block">
                        <span className="text-sm text-gray-300">{f.label}</span>
                        <input
                          type="password"
                          autoComplete="off"
                          placeholder={p.values[f.field] || t('не збережено')}
                          value={drafts[p.id]?.[f.field] ?? ''}
                          onChange={(e) => setDrafts((prev) => ({
                            ...prev, [p.id]: { ...(prev[p.id] || {}), [f.field]: e.target.value },
                          }))}
                          className="mt-1 w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm"
                        />
                        {f.hint && <span className="text-xs text-gray-500">{f.hint}</span>}
                      </label>
                    ))}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => save(p.id)}
                        disabled={busy === p.id}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
                      >
                        {busy === p.id ? <Loader2 size={16} className="animate-spin" /> : t('Зберегти ключі')}
                      </button>
                      {saved === p.id && (
                        <span className="text-sm text-emerald-300 inline-flex items-center gap-1">
                          <Check size={14} /> {t('Збережено')}
                        </span>
                      )}
                      <span className="text-xs text-gray-500">{t('Порожнє поле лишає збережене без змін.')}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-500">
          {t('Ключі зберігаються зашифрованими і ніколи не повертаються на екран — видно лише останні чотири символи. Доступ має тільки власник.')}
        </p>
      </div>
    </>
  );
}
