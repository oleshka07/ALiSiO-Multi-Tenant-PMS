'use client';

/**
 * Сторінка, яку відкриває ТЕЛЕФОН гостя після QR у холі.
 *
 * ── Чому вона взагалі існує ────────────────────────────────────────────
 *
 * Камери на терміналі немає (86" на стіні, не планшет), тож напрямок
 * зворотний до звичного: QR малює екран, а сканує гість. Далі він заселяється
 * в себе в браузері — де є клавіатура його мовою, його камера для документа і
 * де за спиною ніхто не читає прізвище.
 *
 * ── Що вона НЕ робить ──────────────────────────────────────────────────
 *
 * Не заселяє і не реєструє. Знаходить бронь тим самим правилом, що термінал
 * (два чинники, цей будинок, вікно ±1 день — усе в `handoffFind`), і віддає
 * посилання на ГОСТЬОВИЙ ПОРТАЛ, який усе це вже вміє. Другого заселення в
 * продукті не заводиться.
 *
 * ── Мова ───────────────────────────────────────────────────────────────
 *
 * Той самий словник, що на терміналі (`KIOSK_STRINGS`), і той самий
 * перемикач: тут теж читає ГІСТЬ, а не оператор (інваріант 19).
 */

import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { KioskCalendar, formatDay, localToday } from '@/apps/kiosk/ui/KioskCalendar';
import {
  KIOSK_LANGS, KIOSK_LANG_LABELS, KIOSK_STRINGS, kioskLang, type KioskLang,
} from '@/apps/kiosk/ui/translations';

type FindBy = 'date' | 'confirmation';

export default function KioskHandoffPage() {
  const params = useParams<{ ticket: string }>();
  const ticket = String(params?.ticket ?? '');
  const [lang, setLang] = useState<KioskLang>('de');
  const [findBy, setFindBy] = useState<FindBy | null>(null);
  const [lastName, setLastName] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [today] = useState(() => localToday());

  const s = KIOSK_STRINGS[lang];
  const canSubmit = useMemo(
    () => !!lastName.trim() && (findBy === 'date' ? !!checkIn : !!confirmation.trim()),
    [lastName, findBy, checkIn, confirmation]);

  const submit = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/apps/kiosk/handoff/find', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ticket,
          lastName: lastName.trim() || undefined,
          checkIn: findBy === 'date' ? (checkIn || undefined) : undefined,
          confirmation: findBy === 'confirmation' ? (confirmation.trim() || undefined) : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        found?: boolean; reason?: string; portalPath?: string; error?: string;
      };
      if (res.status === 400) { setMessage(body.error === 'need_factors' ? s.needFactors : (body.error ?? s.notFound)); return; }
      if (!res.ok) { setMessage(s.notFoundHelp); return; }
      if (!body.found) { setMessage(body.reason === 'need_more' ? s.needMore : s.notFound); return; }
      // Далі — звичайний гостьовий портал: він уже вміє документ, згоду й підпис.
      window.location.href = body.portalPath ?? '/';
    } finally {
      setBusy(false);
    }
  }, [ticket, lastName, checkIn, confirmation, findBy, s]);

  return (
    <div className="kiosk-root" data-step="handoff" data-phone="true">
      <div className="kiosk-top">
        <h1 className="kiosk-title">{s.lookupTitle}</h1>
        <div className="kiosk-langs">
          {KIOSK_LANGS.map((code) => (
            <button
              key={code}
              type="button"
              className="kiosk-lang"
              data-on={lang === code}
              onClick={() => setLang(kioskLang(code))}
            >
              {KIOSK_LANG_LABELS[code]}
            </button>
          ))}
        </div>
      </div>

      <div className="kiosk-phone">
        {findBy === null ? (
          <div className="kiosk-lookup">
            <p className="kiosk-lead">{s.lookupLead}</p>
            <div className="kiosk-tiles">
              <button type="button" className="kiosk-tile" onClick={() => setFindBy('date')}>
                <span className="kiosk-tile-title">{s.byDate}</span>
                <span className="kiosk-tile-help">{s.byDateHelp}</span>
              </button>
              <button type="button" className="kiosk-tile" onClick={() => setFindBy('confirmation')}>
                <span className="kiosk-tile-title">{s.byConfirmation}</span>
                <span className="kiosk-tile-help">{s.byConfirmationHelp}</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/*
              Тут поля СПРАВЖНІ (`<input>`), а не екранна клавіатура: у гостя в
              руках телефон із власною клавіатурою, і своя була б гіршою копією
              тієї, яку він знає.
            */}
            <label className="kiosk-field">
              <span className="kiosk-label">{s.lastName}</span>
              <input
                className="kiosk-input"
                value={lastName}
                autoComplete="family-name"
                onChange={(e) => setLastName(e.target.value)}
              />
            </label>

            {findBy === 'date' ? (
              <div className="kiosk-field">
                <span className="kiosk-label">{s.arrivalDate}</span>
                <button type="button" className="kiosk-value" onClick={() => setPicking((v) => !v)}>
                  {checkIn ? formatDay(checkIn, lang) : <span className="kiosk-placeholder">{s.pickDate}</span>}
                </button>
                {picking && (
                  <KioskCalendar
                    value={checkIn || null}
                    today={today}
                    lang={lang}
                    onPick={(d) => { setCheckIn(d); setPicking(false); }}
                  />
                )}
              </div>
            ) : (
              <label className="kiosk-field">
                <span className="kiosk-label">{s.confirmationNo}</span>
                <input
                  className="kiosk-input"
                  value={confirmation}
                  inputMode="numeric"
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            )}

            {message && <p className="kiosk-note">{message}</p>}
            <button
              type="button"
              className="kiosk-big"
              data-primary="true"
              disabled={busy || !canSubmit}
              onClick={() => void submit()}
            >
              {s.next}
            </button>
            <button type="button" className="kiosk-slim" onClick={() => { setFindBy(null); setMessage(null); }}>
              {s.back}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
