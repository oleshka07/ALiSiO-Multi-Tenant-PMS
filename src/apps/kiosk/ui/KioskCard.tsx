'use client';

/**
 * Картка застосунку «Кіоск» — термінали, політики, вигляд.
 *
 * Окремим компонентом, а не ще двома сотнями рядків у `settings/apps/page.tsx`:
 * та сторінка вже на 587 рядків, і кожен наступний застосунок робив би її
 * довшою на свою картку. Сторінка лишається списком карток, а що всередині —
 * справа застосунку.
 *
 * ── Мова тут `t()`, і це не суперечить КІ11 ─────────────────────────────
 *
 * КІ11 каже: екран ГОСТЯ має власний словник, бо мову там обирає гість. Це
 * екран ОПЕРАТОРА — тут мову веде адмінка, і `t()` саме для неї (інваріант
 * 19 розрізняє їх так само).
 *
 * ── Код парування показується ОДИН раз ──────────────────────────────────
 *
 * У базі лежить `sha256(код)`. Тобто «показати ще раз» тут не «не зробили» —
 * це неможливо за побудовою, і напис поруч каже це словами, щоб адміністратор
 * не шукав кнопку, якої не буде.
 */

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@core/i18n/client';
import { usePropertyScope } from '@/ui/PropertyScopeContext';

interface Device {
  id: string;
  name: string;
  propertyId: string;
  pairedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

interface Policies {
  checkinPaymentPolicy: 'prepaid' | 'allow_pay_later';
  systemOfRecord: 'alisio' | 'external';
  walkinUrl: string;
  autoAssign: boolean;
  signature: 'foreigners' | 'always' | 'never';
  earliestCheckIn: string | null;
  latestCheckOut: string | null;
}

const line = '1px solid var(--border-color)';
const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');

export function KioskCard() {
  const t = useT();
  // Обʼєкт — із області, яку тримає шапка (`PropertyScopeProvider`), а не
  // власний `useState`: другий стан області означав би дві вкладки, які
  // бʼються між собою, і саме це забороняє `check-property-scope`.
  const { propertyId } = usePropertyScope();
  const [devices, setDevices] = useState<Device[]>([]);
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await fetch('/api/settings/apps/kiosk/devices');
    if (d.ok) setDevices(((await d.json()) as { devices: Device[] }).devices);
    if (propertyId) {
      const p = await fetch(`/api/settings/apps/kiosk/policies?property_id=${encodeURIComponent(propertyId)}`);
      if (p.ok) setPolicies((await p.json()) as Policies);
    }
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  async function addTerminal() {
    if (!propertyId) { setNote(t('Спершу оберіть обʼєкт у шапці')); return; }
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/settings/apps/kiosk/pairings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId, name: name.trim() || t('Термінал') }),
      });
      const body = await res.json();
      if (!res.ok) { setNote(String(body.error ?? t('Не вдалося створити код'))); return; }
      setCode(String(body.code));
      setName('');
      await load();
    } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/settings/apps/kiosk/devices/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
      await load();
    } finally { setBusy(false); }
  }

  async function savePolicies(next: Partial<Policies>) {
    if (!propertyId || !policies) return;
    const merged = { ...policies, ...next };
    setPolicies(merged);
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/settings/apps/kiosk/policies', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId, ...merged }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Відмову видно, і вона названа: мовчазне «не збереглося» тут гірше
        // за помилку — готель думав би, що політика стоїть.
        setNote(String(body.error ?? t('Не вдалося зберегти')));
        await load();
      }
    } finally { setBusy(false); }
  }

  return (
    <div data-testid="kiosk-card" style={{ padding: '12px 18px 16px 18px', borderTop: line, fontSize: 12 }}>
      {/* ── Термінали ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('Назва термінала (напр. хол)')}
          style={{ padding: '8px 10px', fontSize: 12, borderRadius: 6, border: line, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        />
        <button className="btn btn-secondary" style={{ fontSize: 13 }} data-testid="kiosk-add-terminal" disabled={busy} onClick={addTerminal}>
          {t('Додати термінал')}
        </button>
      </div>

      {code && (
        <div style={{ marginBottom: 10 }} data-testid="kiosk-pairing-code">
          <div style={{ color: 'var(--danger)', marginBottom: 4 }}>
            {t('Наберіть цей код на терміналі протягом 10 хвилин. Удруге він не покажеться — у базі лише його відбиток.')}
          </div>
          <div style={{ fontSize: 28, fontFamily: 'monospace', letterSpacing: 4 }}>{code}</div>
        </div>
      )}

      {devices.length === 0
        ? <div style={{ color: 'var(--text-secondary)', marginBottom: 10 }}>{t('Терміналів ще немає')}</div>
        : (
          <table style={{ width: '100%', marginBottom: 12, fontSize: 12 }}>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} data-testid="kiosk-device">
                  <td style={{ padding: '4px 0' }}>{d.name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {t('останній звʼязок')}: {fmt(d.lastSeenAt)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {d.revokedAt
                      ? <span className="badge badge-secondary">{t('відкликано')}</span>
                      : (
                        <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy} onClick={() => revoke(d.id)}>
                          {t('Відкликати')}
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      {/* ── Політики обʼєкта ──────────────────────────────────────────── */}
      {policies && (
        <div style={{ borderTop: line, paddingTop: 10 }} data-testid="kiosk-policies">
          <label style={{ display: 'block', marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={policies.checkinPaymentPolicy === 'allow_pay_later'}
              onChange={(e) => savePolicies({ checkinPaymentPolicy: e.target.checked ? 'allow_pay_later' : 'prepaid' })}
            />{' '}
            {t('Пускати в номер до оплати (платять уранці або при виїзді)')}
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={policies.autoAssign}
              onChange={(e) => savePolicies({ autoAssign: e.target.checked })}
            />{' '}
            {t('Термінал сам обирає вільний чистий номер')}
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>
            {t('Підпис')}:{' '}
            <select
              value={policies.signature}
              onChange={(e) => savePolicies({ signature: e.target.value as Policies['signature'] })}
            >
              <option value="foreigners">{t('лише іноземці (за законом)')}</option>
              <option value="always">{t('усі')}</option>
              <option value="never">{t('не збирати')}</option>
            </select>
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>
            {t('Адреса бронювання для walk-in')}:{' '}
            <input
              value={policies.walkinUrl}
              onChange={(e) => setPolicies({ ...policies, walkinUrl: e.target.value })}
              onBlur={(e) => savePolicies({ walkinUrl: e.target.value })}
              placeholder="https://…"
              style={{ width: 320, padding: '6px 8px', fontSize: 12, borderRadius: 6, border: line, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
            />
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>
            {t('Найраніше заселення')}:{' '}
            <input
              type="time"
              value={policies.earliestCheckIn ?? ''}
              onChange={(e) => savePolicies({ earliestCheckIn: e.target.value || null })}
            />{' '}
            {t('Найпізніше виселення')}:{' '}
            <input
              type="time"
              value={policies.latestCheckOut ?? ''}
              onChange={(e) => savePolicies({ latestCheckOut: e.target.value || null })}
            />
          </label>
          <div style={{ color: 'var(--text-tertiary)' }}>
            {t('Порожня година означає «як в обʼєкта», а не «будь-коли»')}
          </div>
        </div>
      )}

      {note && <div style={{ color: 'var(--danger)', marginTop: 8 }} data-testid="kiosk-note">{note}</div>}
      <div style={{ marginTop: 8 }}>
        <a href="/app/settings/apps/kiosk-today">{t('Kiosk heute — події терміналів за добу')}</a>
      </div>
    </div>
  );
}
