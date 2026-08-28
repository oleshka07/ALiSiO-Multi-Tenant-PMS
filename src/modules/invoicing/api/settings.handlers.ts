/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Бланк фактури цього готеля: строк оплати, поріг покупця, вигляд.
 *
 * Варта — у фасаді (`api/index.ts`), як і в решти модуля.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';
import { organizationCurrency } from '@core/currency';
import { invoiceSettings, saveInvoiceSettings } from '../data/invoice-settings.repo';

export async function getInvoiceSettings(_req: Request, _ctx: unknown, actor: Actor) {
  try {
    return NextResponse.json({
      settings: await invoiceSettings(actor.organizationId),
      // Валюта — щоб екран підписав поріг правильно. Саме її відсутність і
      // була вадою старого порогу: 9900 без валюти означало крони для всіх.
      currency: await organizationCurrency(actor.organizationId),
    });
  } catch (e: any) {
    return serverError('GET /api/invoicing/settings', e);
  }
}

export async function putInvoiceSettings(request: NextRequest, _ctx: unknown, actor: Actor) {
  try {
    const body = await request.json().catch(() => ({}));

    const dueDays = Number(body.dueDays);
    if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) {
      return NextResponse.json({ error: 'Строк оплати — ціле число від 0 до 365 днів' }, { status: 400 });
    }

    // Порожнє поле означає «називати покупця завжди», а не нуль. Нуль тут —
    // це «поріг 0», тобто теж завжди, але сказане випадково; розрізняти їх
    // важливо, бо порожнє поле людина лишає свідомо.
    const rawThreshold = body.buyerNameThreshold;
    let buyerNameThreshold: number | null = null;
    if (rawThreshold !== null && rawThreshold !== undefined && String(rawThreshold).trim() !== '') {
      const n = Number(String(rawThreshold).replace(',', '.'));
      if (!isFinite(n) || n < 0) {
        return NextResponse.json({ error: 'Поріг має бути невідʼємним числом' }, { status: 400 });
      }
      buyerNameThreshold = n;
    }

    const str = (v: unknown) => {
      const s = String(v ?? '').trim();
      return s === '' ? null : s;
    };
    const accentColor = str(body.accentColor);
    if (accentColor && !/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
      return NextResponse.json({ error: 'Колір — у форматі #RRGGBB' }, { status: 400 });
    }

    const settings = await saveInvoiceSettings(actor.organizationId, {
      dueDays,
      buyerNameThreshold,
      logoUrl: str(body.logoUrl),
      accentColor,
      footerNote: str(body.footerNote),
      showPaymentQr: body.showPaymentQr === true,
    });
    return NextResponse.json({ ok: true, settings });
  } catch (e: any) {
    return serverError('PUT /api/invoicing/settings', e);
  }
}
