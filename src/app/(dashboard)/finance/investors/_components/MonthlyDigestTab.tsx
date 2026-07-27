'use client';

import { useCallback, useEffect, useState } from 'react';
import { Send, Copy, Mail, MessageCircle, AlertCircle, Eye } from 'lucide-react';

interface DigestProperty {
  project_id: string;
  project_name: string;
  equity_pct: number | null;
  occupancy_pct: number | null;
  revenue: number;
  monthly_profit: number;
  paid_this_month: number;
  accumulated_profit: number;
  total_paid_to_date: number;
  pending_to_date: number;
}

interface DigestInvestor {
  investor_id: string;
  investor_name: string;
  email: string | null;
  telegram_chat_id: string | null;
  portal_token: string;
  currency: string;
  active_lots: number;
  totals: {
    monthly_revenue: number;
    monthly_profit: number;
    paid_this_month: number;
    accumulated_profit: number;
    total_paid_to_date: number;
    pending_to_date: number;
  };
  properties: DigestProperty[];
  has_any_metric: boolean;
}

function fmt(n: number, cur: string): string {
  return `${n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

export default function MonthlyDigestTab() {
  const [yearMonth, setYearMonth] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1); // default: previous month
    return d.toISOString().substring(0, 7);
  });
  const [items, setItems] = useState<DigestInvestor[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewText, setPreviewText] = useState<{ name: string; text: string } | null>(null);
  const [tgBot, setTgBot] = useState<{ ok: boolean; username?: string; error?: string } | null>(null);

  // Probe whether the Telegram bot is configured on the server. If yes,
  // the per-investor "Telegram" button becomes active.
  useEffect(() => {
    fetch('/api/finance/telegram-bot').then(async (r) => setTgBot(await r.json())).catch(() => setTgBot({ ok: false }));
  }, []);

  async function sendTelegram(d: DigestInvestor) {
    if (!d.telegram_chat_id) { alert('У інвестора не вказано telegram_chat_id'); return; }
    if (!confirm(`Відправити звіт у Telegram (chat_id: ${d.telegram_chat_id})?`)) return;
    try {
      const res = await fetch('/api/finance/investor-monthly-digest/send-telegram', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ investor_id: d.investor_id, year_month: yearMonth }),
      });
      const json = await res.json();
      if (!res.ok) { alert(`Telegram error: ${json.error}`); return; }
      alert('✓ Відправлено у Telegram');
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
  }

  const fetchDigest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/investor-monthly-digest?year_month=${yearMonth}`);
      const json = await res.json();
      if (!res.ok) { alert(`Помилка: ${json.error}`); setItems([]); }
      else setItems(json.investors || []);
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
    setLoading(false);
  }, [yearMonth]);

  useEffect(() => { fetchDigest(); }, [fetchDigest]);

  async function loadText(investorId: string, name: string) {
    try {
      const res = await fetch(`/api/finance/investor-monthly-digest?year_month=${yearMonth}&investor_id=${investorId}&text=1`);
      const json = await res.json();
      if (!res.ok) { alert(`Помилка: ${json.error}`); return; }
      setPreviewText({ name, text: json.text });
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
  }

  async function copyText(investorId: string) {
    try {
      const res = await fetch(`/api/finance/investor-monthly-digest?year_month=${yearMonth}&investor_id=${investorId}&text=1`);
      const json = await res.json();
      if (!res.ok) { alert(`Помилка: ${json.error}`); return; }
      await navigator.clipboard.writeText(json.text);
      alert('✓ Скопійовано');
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
  }

  async function emailDigest(d: DigestInvestor) {
    if (!d.email) { alert('У інвестора немає email'); return; }
    try {
      const res = await fetch(`/api/finance/investor-monthly-digest?year_month=${yearMonth}&investor_id=${d.investor_id}&text=1`);
      const json = await res.json();
      if (!res.ok) { alert(`Помилка: ${json.error}`); return; }
      const subject = encodeURIComponent(`Звіт інвестору · ${yearMonth}`);
      const body = encodeURIComponent(json.text);
      window.location.href = `mailto:${d.email}?subject=${subject}&body=${body}`;
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Місяць</label>
          <input type="month" style={input} value={yearMonth} onChange={(e) => setYearMonth(e.target.value)} />
        </div>
        <button onClick={fetchDigest} style={{ ...btn, background: '#3b82f6', color: '#fff', border: 'none' }} disabled={loading}>
          {loading ? 'Завантаження…' : 'Оновити'}
        </button>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        Зведення обчислюється з метрик (Occupancy + Revenue) обраного місяця × частки інвестора. Виплати показуються ті, що з paid_at у цьому місяці. Для кожного інвестора окрема картка — клік на «Email», «Copy» або «Telegram» бере готовий текст.
      </p>
      <div style={{ fontSize: 11, marginBottom: 16, padding: 8, background: tgBot?.ok ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)', borderRadius: 6, color: tgBot?.ok ? '#16a34a' : '#92400e' }}>
        {tgBot === null ? 'Перевіряю стан Telegram-бота…'
          : tgBot.ok ? `✓ Telegram-бот @${tgBot.username} підключено`
          : `⚠ Telegram-бот не налаштовано (${tgBot.error}). Додайте TELEGRAM_BOT_TOKEN у .env на сервері та перезапустіть. Без нього кнопка «Telegram» неактивна.`}
      </div>

      {items.length === 0 && !loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border-primary)', borderRadius: 8 }}>
          Активних інвесторів з лотами немає.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
          {items.map((d) => (
            <div key={d.investor_id} style={{ border: '1px solid var(--border-primary)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{d.investor_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {d.email || 'без email'} · лотів: {d.active_lots}
                  </div>
                </div>
                {!d.has_any_metric && (
                  <span style={{ fontSize: 11, color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: 'rgba(245,158,11,0.1)', borderRadius: 4 }}>
                    <AlertCircle size={12} /> Немає метрик за {yearMonth}
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                <Stat label="Прибуток за місяць" value={fmt(d.totals.monthly_profit, d.currency)} />
                <Stat label="Виплачено цього місяця" value={fmt(d.totals.paid_this_month, d.currency)} />
                <Stat label="До виплати накопичено" value={fmt(d.totals.pending_to_date, d.currency)} highlight />
                <Stat label="Виручка проєктів" value={fmt(d.totals.monthly_revenue, d.currency)} />
              </div>

              <details>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
                  Деталі по {d.properties.length} {d.properties.length === 1 ? 'об\'єкту' : 'об\'єктах'}
                </summary>
                <table style={{ width: '100%', marginTop: 8, fontSize: 11, borderCollapse: 'collapse' }}>
                  <tbody>
                    {d.properties.map((p) => (
                      <tr key={p.project_id} style={{ borderTop: '1px solid var(--border-primary)' }}>
                        <td style={{ padding: 4 }}>
                          <div style={{ fontWeight: 600 }}>{p.project_name}</div>
                          <div style={{ color: 'var(--text-secondary)' }}>
                            {p.equity_pct ? `${p.equity_pct}% частка` : ''}
                            {p.occupancy_pct != null && ` · occ ${p.occupancy_pct}%`}
                          </div>
                        </td>
                        <td style={{ padding: 4, textAlign: 'right' }}>
                          <div>{fmt(p.monthly_profit, d.currency)}</div>
                          {p.paid_this_month > 0 && <div style={{ color: '#22c55e' }}>виплачено {fmt(p.paid_this_month, d.currency)}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => loadText(d.investor_id, d.investor_name)} style={btn}><Eye size={12} /> Preview</button>
                <button onClick={() => copyText(d.investor_id)} style={btn}><Copy size={12} /> Copy</button>
                {d.email && <button onClick={() => emailDigest(d)} style={btn}><Mail size={12} /> Email</button>}
                {d.telegram_chat_id && (
                  <button onClick={() => sendTelegram(d)}
                          disabled={!tgBot?.ok}
                          title={tgBot?.ok ? `Відправити у Telegram (${d.telegram_chat_id})` : 'Бот не налаштований'}
                          style={{ ...btn, opacity: tgBot?.ok ? 1 : 0.5, cursor: tgBot?.ok ? 'pointer' : 'not-allowed' }}>
                    <MessageCircle size={12} /> Telegram
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {previewText && (
        <div style={overlayStyle} onClick={() => setPreviewText(null)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Preview · {previewText.name}</h3>
              <button onClick={() => { navigator.clipboard.writeText(previewText.text); alert('✓ Скопійовано'); }} style={btn}>
                <Copy size={12} /> Copy
              </button>
            </div>
            <pre style={{ background: 'var(--bg-secondary)', padding: 14, borderRadius: 8, fontSize: 12, fontFamily: 'inherit', whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto' }}>{previewText.text}</pre>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setPreviewText(null)} style={btn}>Закрити</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', padding: 8, borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: highlight ? '#f59e0b' : 'inherit' }}>{value}</div>
    </div>
  );
}

const input: React.CSSProperties = { padding: '7px 10px', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)' };
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 12, fontWeight: 500, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderRadius: 6, cursor: 'pointer' };
const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
const modalStyle: React.CSSProperties = { background: 'var(--bg-primary)', borderRadius: 12, padding: 20, minWidth: 480, maxWidth: 700, maxHeight: '90vh', overflow: 'auto' };
