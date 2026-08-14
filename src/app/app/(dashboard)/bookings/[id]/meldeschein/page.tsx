'use client';

/**
 * Der Meldeschein — бланк, який іноземний гість підписує на рецепції.
 *
 * Дві мови на одній сторінці, і це навмисно:
 *
 *   бланк     німецькою, завжди — це документ юрисдикції, а не інтерфейс.
 *             Тому підписи полів тут написані літералами, а не через t():
 *             перекладений «Familienname» — це вже інший документ (інваріант 19).
 *   обгортка  мовою оператора — кнопки, попередження, перелік порожніх полів.
 *             Це те, що читає рецепція, а не гість.
 *
 * Головне, що робить ця сторінка, — іноді НЕ друкує нічого. З 01.01.2025
 * німецький гість не реєструється взагалі, і тоді тут стоїть пояснення, а не
 * бланк. Правило — у modules/guests/domain/meldeschein.ts, тут лише показ.
 *
 * Порожні поля не заважають друкові: бланк існує саме для того, щоб гість
 * дописав рукою те, чого готель не знає. Але рецепція бачить перелік — щоб
 * знала, про що спитати, поки гість ще стоїть перед нею.
 */

import { useT } from '@core/i18n/client';
import { useState, useEffect, use } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import { Printer, Loader2, ArrowLeft } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Німецькі підписи полів § 30 Abs. 2 BMG — текст документа, не інтерфейсу. */
const LABEL: Record<string, string> = {
  arrival: 'Tag der Ankunft',
  departure: 'Tag der voraussichtlichen Abreise',
  last_name: 'Familienname',
  first_name: 'Vorname(n)',
  date_of_birth: 'Geburtsdatum',
  nationality: 'Staatsangehörigkeit(en)',
  address: 'Anschrift (Straße, Hausnummer, PLZ, Ort, Staat)',
  companions: 'Zahl der Mitreisenden',
  document_number: 'Seriennummer des Passes oder Passersatzpapiers',
};

export default function MeldescheinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const onMenuClick = useMobileMenu();

  const [form, setForm] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/bookings/${id}/meldeschein`);
        const data = await res.json();
        if (!alive) return;
        if (res.ok) setForm(data);
        else setError(data.error || 'Failed');
      } catch (e) {
        console.error(e);
        if (alive) setError('Failed');
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id]);

  /** Чому бланк не потрібен — мовою оператора, бо це читає рецепція. */
  const reasonText = (reason: string) => ({
    german_national: t('громадянин Німеччини — з 01.01.2025 не реєструється'),
    not_germany: t('обʼєкт не в Німеччині — діють правила своєї країни'),
    nationality_unknown: t('громадянство не вказане'),
    foreign_national: t('іноземний громадянин'),
  }[reason] || reason);

  return (
    <>
      <Header title={t('Meldeschein')} onMenuClick={onMenuClick} />
      <div className="app-content">
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .sheet, .sheet * { visibility: visible; }
            .sheet { position: absolute; left: 0; top: 0; width: 100%; }
            .no-print { display: none !important; }
            .form { page-break-after: always; }
            .form:last-child { page-break-after: auto; }
          }
        `}</style>

        <div className="page-header no-print">
          <div>
            <h2 className="page-title">{t('Meldeschein')}</h2>
            <div className="page-subtitle">
              {t('Бланк реєстрації для іноземних гостей — §§ 29, 30 BMG')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => history.back()}>
              <ArrowLeft size={16} /> {t('Назад')}
            </button>
            {form?.people?.length > 0 && (
              <button className="btn btn-primary" onClick={() => window.print()}>
                <Printer size={16} /> {t('Друк')}
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 64 }}>
            <Loader2 size={24} className="animate-pulse" style={{ display: 'inline-block' }} />{' '}
            {t('Завантаження...')}
          </div>
        ) : error ? (
          <div style={{ color: 'var(--danger)', padding: 20 }}>
            {error === 'Not found' ? t('Бронювання не знайдено.') : t('Не вдалося завантажити.')}
          </div>
        ) : (
          <>
            {/* Ніхто не реєструється — це відповідь, а не порожня сторінка. */}
            {form.people.length === 0 && (
              <div className="card no-print" style={{ padding: 20, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {t('Бланк не потрібен — нікого реєструвати.')}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {t('З 01.01.2025 (BEG IV) гості з громадянством Німеччини не заповнюють Meldeschein, і готель не зберігає їхніх бланків. Обовʼязок лишився тільки для іноземних громадян.')}
                </div>
              </div>
            )}

            {form.exempt.length > 0 && (
              <div className="card no-print" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('Без бланка')}</div>
                {form.exempt.map((p: any) => (
                  <div key={p.guest_id} style={{ fontSize: 13, marginBottom: 4 }}>
                    {p.name} — <span style={{ color: 'var(--text-tertiary)' }}>{reasonText(p.reason)}</span>
                  </div>
                ))}
              </div>
            )}

            {form.people.length > 0 && (
              <>
                <div className="card no-print" style={{ padding: 16, marginBottom: 16, fontSize: 13 }}>
                  {/* Строк — це обовʼязок у обидва боки: і не знищити раніше, і не тримати довше. */}
                  {t('Зберігати до')}: <b>{form.keepUntil}</b> · {t('знищити до')}: <b>{form.destroyBy}</b>
                  <div style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {t('Рік від дня виїзду, потім три місяці на знищення (§ 30 Abs. 4 BMG).')}
                  </div>
                </div>

                <div className="sheet">
                  {form.people.map((p: any) => (
                    <FormSheet key={p.guest_id} person={p} form={form} t={t} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Один бланк на одну людину. Німецькою — бо це німецький документ. */
function FormSheet({ person, form, t }: { person: any; form: any; t: (s: string) => string }) {
  const value = (field: string) =>
    field === 'companions' ? String(person.companions ?? '') : (person[field] ?? '');

  const hotel = [form.property_name, form.property_address, form.property_city]
    .filter(Boolean).join(', ');

  return (
    <div className="form" style={{ marginBottom: 32, border: '1px solid var(--border)', padding: 20 }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>Meldeschein</div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
        Beherbergungsstätte gemäß §§ 29, 30 Bundesmeldegesetz
      </div>

      <div style={{ fontSize: 13, marginBottom: 16 }}>
        <div><b>{hotel || '—'}</b></div>
        {form.unit_code && <div>Zimmer: {form.unit_code}</div>}
      </div>

      {/* Незаповнене поле лишається порожнім рядком — гість допише його рукою. */}
      <table className="table" style={{ width: '100%' }}>
        <tbody>
          {Object.keys(LABEL).map((field) => (
            <tr key={field}>
              <td style={{ width: '45%', fontSize: 13 }}>{LABEL[field]}</td>
              <td style={{ borderBottom: '1px solid #999', minWidth: 200 }}>
                {String(value(field))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {person.missing.length > 0 && (
        <div className="no-print" style={{ marginTop: 10, fontSize: 12, color: 'var(--warning, #b45309)' }}>
          {t('Порожні поля — гість дописує на місці')}:{' '}
          {person.missing.map((f: string) => LABEL[f]).join(', ')}
        </div>
      )}

      <div style={{ marginTop: 24, fontSize: 11, lineHeight: 1.5 }}>
        Die Beherbergungsstätte hat die Angaben mit dem vorgelegten Identitätsdokument
        abzugleichen. Der Meldeschein wird ein Jahr ab dem Tag der Abreise aufbewahrt und
        innerhalb von drei Monaten danach vernichtet (§ 30 Abs. 4 BMG).
      </div>

      <div style={{ display: 'flex', gap: 32, marginTop: 32, fontSize: 12 }}>
        <div style={{ flex: 1, borderTop: '1px solid #999', paddingTop: 4 }}>Ort, Datum</div>
        <div style={{ flex: 1, borderTop: '1px solid #999', paddingTop: 4 }}>
          Unterschrift des Beherbergten
        </div>
      </div>
    </div>
  );
}
