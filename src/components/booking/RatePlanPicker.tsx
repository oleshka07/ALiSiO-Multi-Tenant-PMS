'use client';
/**
 * Прейскурант (тариф) у формі створення броні.
 *
 * ── Чому список залежить від ПЛАТНИКА ───────────────────────────────────
 *
 * Фірмовий тариф — ціна для однієї фірми (INC-205). Тому список питає
 * `/api/pricing/rate-plans/for-payer?property_id=…&company_id=…`, і зміна
 * фірми в сусідньому полі його перепитує: інакше портьє, який спершу обрав
 * фірму А з її тарифом, а потім перемкнув на фірму Б, лишався б із тарифом,
 * якого Б купити не може.
 *
 * Але звуження списку — це ЗРУЧНІСТЬ, а не захист: `ratePlanId` їде в тілі
 * запиту, і писач звіряє його сам (`assertRatePlanForPayer`, гейт
 * `booking-rate-plan.check`). Той самий урок, що INC-201…203.
 *
 * ── Чому `<select>`, а не пошук ─────────────────────────────────────────
 *
 * Тарифів у готелю одиниці — це прейскурант, а не довідник контрагентів.
 * Пошук тут був би зайвим кроком на кожну бронь.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useT } from '@core/i18n/client';
import { Tag } from 'lucide-react';

export interface PayerRatePlanRow {
  id: string;
  code: string;
  name: string;
  currency: string;
  companyOnly: boolean;
}

interface Props {
  /** Обʼєкт, чиї тарифи показуємо. Порожньо — «усі обʼєкти», тарифів не питаємо. */
  propertyId: string | null;
  /** Фірма-платник; `null` — платить гість, і фірмові тарифи зникають зі списку. */
  companyId: string | null;
  value: string;
  onChange: (ratePlanId: string) => void;
}

export default function RatePlanPicker({ propertyId, companyId, value, onChange }: Props) {
  const t = useT();
  const [plans, setPlans] = useState<PayerRatePlanRow[] | null>(null);
  // Пізня відповідь на стару пару «обʼєкт + фірма» не має перетерти свіжу.
  const seq = useRef(0);

  useEffect(() => {
    if (!propertyId) { setPlans([]); return; }
    const mine = ++seq.current;
    (async () => {
      try {
        const qs = new URLSearchParams({ property_id: propertyId });
        if (companyId) qs.set('company_id', companyId);
        const res = await fetch(`/api/pricing/rate-plans/for-payer?${qs}`);
        if (!res.ok) { if (mine === seq.current) setPlans([]); return; }
        // Форма відповіді — МАСИВ рядків, виміряна в `listRatePlansForPayer`
        // (`NextResponse.json(await ratePlansForPayer(…))`), а не вгадана.
        const body = await res.json() as PayerRatePlanRow[];
        if (mine !== seq.current) return;
        setPlans(Array.isArray(body) ? body : []);
      } catch { if (mine === seq.current) setPlans([]); }
    })();
  }, [propertyId, companyId]);

  // Обраний тариф, якого в новому списку немає (перемкнули фірму), скидається:
  // лишити його означало б показувати одне, а надіслати інше — і писач
  // однаково відмовив би 404 уже після натискання «Створити».
  useEffect(() => {
    if (!value || plans === null) return;
    if (!plans.some((p) => p.id === value)) onChange('');
  }, [plans, value, onChange]);

  if (!propertyId) return null;

  return (
    <div className="form-group">
      <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Tag size={13} /> {t('Прейскурант')}
      </label>
      <select className="form-input" value={value} onChange={(e) => onChange(e.target.value)}
        disabled={plans === null}>
        <option value="">{t('Базова ціна')}</option>
        {(plans ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}{p.companyOnly ? ` · ${t('фірмовий')}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
