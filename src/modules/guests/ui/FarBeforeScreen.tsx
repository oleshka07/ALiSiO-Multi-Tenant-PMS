'use client';
import type { Translations, Lang } from '@/app/guest/[token]/translations';
import { translateContent } from '@/lib/content-translations';

interface Props {
  data: any;
  t: Translations;
  lang: Lang;
  dLeft: number;
  onRegisterClick: () => void;
  isRegistered: boolean;
  checkInTime?: string;
  checkOutTime?: string;
}

export function FarBeforeScreen({ data, t, lang, dLeft, onRegisterClick, isRegistered, checkInTime, checkOutTime }: Props) {
  const r = data.reservation;
  const cfg = data.guestPageConfig;

  const fmt = (d: string) => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  };

  const labels: Record<string, Record<string, string>> = {
    en: { confirmed: 'Booking confirmed & paid', daysTo: `${dLeft} days to go`, regNeeded: 'Registration required', regDone: 'Registration complete', registerNow: 'Register now →', goodToKnow: 'Good to know', checkInAt: 'Check-in from', checkOutBy: 'Check-out by', lockedEntry: 'Available 2 days before check-in', lockedWifi: 'Available on check-in day', lockedParking: 'Available closer' },
    de: { confirmed: 'Buchung bestätigt & bezahlt', daysTo: `Noch ${dLeft} Tage`, regNeeded: 'Registrierung erforderlich', regDone: 'Registrierung abgeschlossen', registerNow: 'Jetzt registrieren →', goodToKnow: 'Gut zu wissen', checkInAt: 'Check-in ab', checkOutBy: 'Check-out bis', lockedEntry: 'Verfügbar 2 Tage vor Ankunft', lockedWifi: 'Verfügbar am Anreisetag', lockedParking: 'Bald verfügbar' },
    cs: { confirmed: 'Rezervace potvrzena a zaplacena', daysTo: `Ještě ${dLeft} dní`, regNeeded: 'Registrace vyžadována', regDone: 'Registrace dokončena', registerNow: 'Zaregistrovat se →', goodToKnow: 'Dobré vědět', checkInAt: 'Check-in od', checkOutBy: 'Check-out do', lockedEntry: 'Dostupné 2 dny před příjezdem', lockedWifi: 'Dostupné v den příjezdu', lockedParking: 'Brzy k dispozici' },
    uk: { confirmed: 'Бронювання підтверджено і оплачено', daysTo: `${dLeft} днів до заїзду`, regNeeded: 'Потрібна реєстрація', regDone: 'Реєстрацію завершено', registerNow: 'Зареєструватися →', goodToKnow: 'Корисно знати', checkInAt: 'Заїзд з', checkOutBy: 'Виїзд до', lockedEntry: 'Доступно за 2 дні до заїзду', lockedWifi: 'Доступно в день заїзду', lockedParking: 'Буде доступно пізніше' },
    pl: { confirmed: 'Rezerwacja potwierdzona i opłacona', daysTo: `${dLeft} dni do przyjazdu`, regNeeded: 'Wymagana rejestracja', regDone: 'Rejestracja zakończona', registerNow: 'Zarejestruj się →', goodToKnow: 'Warto wiedzieć', checkInAt: 'Zameldowanie od', checkOutBy: 'Wymeldowanie do', lockedEntry: 'Dostępne 2 dni przed przyjazdem', lockedWifi: 'Dostępne w dniu przyjazdu', lockedParking: 'Wkrótce dostępne' },
    nl: { confirmed: 'Boeking bevestigd & betaald', daysTo: `Nog ${dLeft} dagen`, regNeeded: 'Registratie vereist', regDone: 'Registratie voltooid', registerNow: 'Nu registreren →', goodToKnow: 'Goed om te weten', checkInAt: 'Check-in vanaf', checkOutBy: 'Check-out voor', lockedEntry: 'Beschikbaar 2 dagen voor aankomst', lockedWifi: 'Beschikbaar op aankomstdag', lockedParking: 'Binnenkort beschikbaar' },
    fr: { confirmed: 'Réservation confirmée et payée', daysTo: `${dLeft} jours avant arrivée`, regNeeded: 'Inscription requise', regDone: 'Inscription complète', registerNow: "S'inscrire →", goodToKnow: 'Bon à savoir', checkInAt: 'Arrivée à partir de', checkOutBy: "Départ jusqu'à", lockedEntry: "Disponible 2 jours avant l'arrivée", lockedWifi: "Disponible le jour d'arrivée", lockedParking: 'Bientôt disponible' },
  };
  const L = labels[lang] || labels.en;

  const amenities = (() => {
    try { return JSON.parse(cfg?.amenities || '[]') as Array<{ icon: string; name: string; [key: string]: string }>; }
    catch { return []; }
  })();

  const amenityName = (a: { icon: string; name: string; [key: string]: string }): string => {
    if (lang !== 'uk') {
      // 1. Per-language column stored in JSON (e.g. name_de)
      const colKey = `name_${lang}`;
      if (a[colKey]) return a[colKey];
      // 2. Static dictionary lookup
      const translated = translateContent(a.name || '', lang);
      if (translated !== a.name) return translated;
    }
    return a.name || '';
  };

  return (
    <div className="gp-far-before">
      {/* Wallet Card */}
      <div className="gp-wallet-card" style={{ margin: '0 16px 16px' }}>
        <div className="gp-wallet-unit">{r?.unit_name}</div>
        <div className="gp-wallet-dates">
          <div>
            <div className="gp-wallet-label">{t.checkIn}</div>
            <div className="gp-wallet-val">{fmt(r?.check_in)}</div>
          </div>
          <div className="gp-wallet-sep">→</div>
          <div>
            <div className="gp-wallet-label">{t.checkOut}</div>
            <div className="gp-wallet-val">{fmt(r?.check_out)}</div>
          </div>
          <div>
            <div className="gp-wallet-label">{t.nights}</div>
            <div className="gp-wallet-val">{r?.nights}</div>
          </div>
        </div>
        <div className="gp-wallet-countdown">✅ {L.confirmed} · {L.daysTo}</div>
      </div>

      {/* Registration block */}
      <div className={`gp-fb-card ${!isRegistered ? 'gp-fb-card--urgent' : ''}`}>
        {isRegistered ? (
          <div className="gp-fb-row">
            <span className="gp-fb-icon">✅</span>
            <span className="gp-fb-text">{L.regDone}</span>
          </div>
        ) : (
          <>
            <div className="gp-fb-row">
              <span className="gp-fb-icon">📋</span>
              <span className="gp-fb-text" style={{ fontWeight: 700 }}>{L.regNeeded}</span>
            </div>
            <button className="gp-fb-reg-btn" onClick={onRegisterClick}>
              {L.registerNow}
            </button>
          </>
        )}
      </div>

      {/* Good to know */}
      <div className="gp-section">
        <div className="gp-section-title">{L.goodToKnow}</div>
        <div className="gp-list-card" style={{ padding: '8px 16px' }}>
          {checkInTime && (
            <div className="gp-info-row">
              <span>🕓</span><span>{L.checkInAt} <b>{checkInTime}</b></span>
            </div>
          )}
          {checkOutTime && (
            <div className="gp-info-row">
              <span>🕙</span><span>{L.checkOutBy} <b>{checkOutTime}</b></span>
            </div>
          )}
          <div className="gp-info-row">
            <span>📞</span>
            <a href="tel:+420773708849" style={{ color: 'var(--gp-tint)', fontWeight: 600 }}>+420 773 708 849</a>
          </div>
        </div>
      </div>

      {/* Your cabin */}
      {amenities.length > 0 && (
        <div className="gp-section">
          <div className="gp-section-title">{t.yourCabin}</div>
          <div className="gp-amenity-chips">
            {amenities.map((a, i) => (
              <span key={i} className="gp-amenity-chip">{a.icon} {amenityName(a)}</span>
            ))}
          </div>
        </div>
      )}

      {/* Locked items */}
      <div className="gp-section">
        <div className="gp-list-card" style={{ padding: '4px 16px' }}>
          {[
            { icon: '🔑', label: t.entry || 'Entry instructions', lock: L.lockedEntry },
            { icon: '📶', label: 'Wi-Fi', lock: L.lockedWifi },
            { icon: '🚗', label: t.parking || 'Parking', lock: L.lockedParking },
          ].map((item, i) => (
            <div key={i} className="gp-fb-locked-row">
              <span>{item.icon} {item.label}</span>
              <span className="gp-fb-locked-badge">🔒 {item.lock}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
