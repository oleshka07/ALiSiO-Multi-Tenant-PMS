/**
 * Фіскальний поділ однієї послуги на компоненти з різними ставками.
 *
 * Сніданок за 15 € — для гостя один рядок; для бухгалтерії — 12 € Speisen
 * (7%) і 3 € Getränke (19%). Lunchpaket 8 € — 70/30. Поділ живе на послузі
 * (additional_services.vat_split, JSON) і розгортається ТУТ, у момент
 * нарахування — ніде в каталозі, замовленні чи гостьовій сторінці його не
 * видно, і це навмисно: вимога Finanzverwaltung — не меню.
 *
 * Суми компонентів у довіднику задані для КАТАЛОЖНОЇ ціни. Рецепція може
 * продати замовлення за іншою сумою (знижка, домовленість) — тоді компоненти
 * масштабуються пропорційно, а копійка заокруглення лягає на останній
 * компонент: рядки завжди сходяться в суму замовлення копійка в копійку,
 * бо фоліо, що не сходиться саме з собою, — це не документ.
 */
import { money } from '../../../core/money.ts';

export interface VatSplitComponent {
  /** Дописується до назви послуги: «Frühstück – Speisen». */
  label: string;
  /** Частка компонента в КАТАЛОЖНІЙ ціні за одиницю, брутто. */
  amount: number;
  vatCode: string;
}

/** Розібраний vat_split, або null — «поділу немає, одна ставка як завжди». */
export function parseVatSplit(raw: unknown): VatSplitComponent[] | null {
  if (raw == null || raw === '') return null;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!Array.isArray(parsed) || parsed.length < 2) return null;
  const out: VatSplitComponent[] = [];
  for (const c of parsed) {
    const label = typeof c?.label === 'string' ? c.label.trim() : '';
    const amount = Number(c?.amount);
    const vatCode = typeof c?.vatCode === 'string' ? c.vatCode
      : typeof c?.vat_code === 'string' ? c.vat_code : '';
    if (!label || !vatCode || !Number.isFinite(amount) || amount <= 0) return null;
    out.push({ label, amount, vatCode });
  }
  return out;
}

export interface SplitLine {
  label: string;
  vatCode: string;
  /** Брутто за одиницю замовлення. */
  unitGross: number;
  /** Брутто за все замовлення (× кількість). */
  totalGross: number;
}

/**
 * Розкласти суму замовлення по компонентах.
 *
 * `unitPrice` — фактична ціна за одиницю в замовленні (може відрізнятись від
 * каталожної), `quantity` — кількість. Гарантія: сума totalGross рядків
 * дорівнює money(unitPrice × quantity) завжди — залишок заокруглення
 * додається до останнього компонента.
 */
export function splitCharge(
  components: readonly VatSplitComponent[],
  unitPrice: number,
  quantity: number,
): SplitLine[] {
  const catalog = components.reduce((s, c) => s + c.amount, 0);
  const orderTotal = money(unitPrice * quantity);
  if (catalog <= 0) return [];

  const lines: SplitLine[] = [];
  let allocated = 0;
  components.forEach((c, i) => {
    const last = i === components.length - 1;
    const total = last ? money(orderTotal - allocated) : money(orderTotal * (c.amount / catalog));
    allocated = money(allocated + total);
    lines.push({
      label: c.label,
      vatCode: c.vatCode,
      unitGross: quantity > 0 ? money(total / quantity) : 0,
      totalGross: total,
    });
  });
  return lines;
}
