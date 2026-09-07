/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Валюти готелю: основна і 1–3 другорядні з курсами.
 *
 * Основна редагується в загальних налаштуваннях (вона одна й лежить в
 * `organizations.default_currency`). Тут — список другорядних і їхні курси.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { serverError, handleError } from '@core/http/errors';
import { todayFor } from '@core/hotel-day';
import {
  organizationCurrency, secondaryCurrencies, latestRate,
  setSecondaryCurrencies, setManualRate, declaredCurrency,
  MAX_SECONDARY_CURRENCIES, type RateSource,
} from '@core/currency';
import { SUPPORTED_CURRENCIES } from './general-settings.handlers';

/**
 * Джерела курсу, які СПРАВДІ існують.
 *
 * `cnb` тягне крон `cron/sync-cnb-rates`, і лише для готелів із основною
 * валютою CZK: фіксинг Чеського нацбанку відповідає на питання «скільки крон
 * коштує євро», і готелю, який веде облік у євро, він не каже нічого.
 *
 * НБУ і ЄЦБ додадуться сюди рядком, коли зʼявиться крон, який їх тягне.
 * Показати їх у списку раніше означало б дати вибрати джерело, яке ніколи
 * не оновить курс, — і готель побачив би це через місяць, у фактурі.
 */
const RATE_SOURCES: RateSource[] = ['manual', 'cnb'];

export const getCurrencies = withActor(async (_req: Request, _ctx: unknown, actor: Actor) => {
  try {
    const base = await organizationCurrency(actor.organizationId);
    const secondary = await secondaryCurrencies(actor.organizationId);
    return NextResponse.json({
      base,
      secondary,
      // ČNB має сенс лише для готелю, який рахує в кронах. Список джерел
      // залежить від основної валюти, а не від коду.
      sources: base === 'CZK' ? RATE_SOURCES : RATE_SOURCES.filter((s) => s === 'manual'),
      supported: SUPPORTED_CURRENCIES.filter((c) => c !== base),
      max: MAX_SECONDARY_CURRENCIES,
    });
  } catch (e: unknown) {
    // Немає основної валюти — це зламаний рядок організації, і саме так це і
    // треба сказати, а не показати порожній екран. Але сказати саме ЦЕ:
    // доти той самий `catch` накривав два читання бази і віддавав клієнтові
    // будь-який `e.message` зі статусом 409 — тобто текст драйвера з назвами
    // колонок, і то так, наче це відповідь про стан організації (рецензія
    // 07.09 раунд 7, П3). Тепер відмова названа на місці кидання
    // (`organizationCurrency` → `refuse(…, 409)`), а решта йде в лог і 500.
    return handleError('modules/properties/api/currency getCurrencies', e);
  }
});

/**
 * Замінити список другорядних валют цілим.
 *
 * Цілим, а не по одній: список короткий, а «додати/прибрати по одній» двома
 * маршрутами дає стан, у якому екран показує одне, база інше — і ніхто не
 * знає, котре з них людина мала на увазі.
 */
export const saveCurrencies = withPermission('manage_properties', async (request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const body = await request.json().catch(() => ({}));
    const incoming = Array.isArray(body.secondary) ? body.secondary : [];

    if (incoming.length > MAX_SECONDARY_CURRENCIES) {
      return NextResponse.json(
        { error: `Другорядних валют не більше ${MAX_SECONDARY_CURRENCIES}` }, { status: 400 });
    }

    const base = await organizationCurrency(actor.organizationId);
    const seen = new Set<string>();
    const clean: { code: string; rateSource: RateSource }[] = [];

    for (const item of incoming) {
      const code = String(item?.code ?? '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) {
        return NextResponse.json({ error: `Код валюти має бути з трьох літер: ${code || '—'}` }, { status: 400 });
      }
      // Основна серед другорядних — не «зайвий рядок», а курс валюти до себе
      // самої, тобто екран, на якому пишеться «1 EUR = 1 EUR».
      if (code === base) {
        return NextResponse.json({ error: `${code} — це основна валюта готелю` }, { status: 400 });
      }
      if (seen.has(code)) {
        return NextResponse.json({ error: `Валюта ${code} названа двічі` }, { status: 400 });
      }
      seen.add(code);

      const source = String(item?.rateSource ?? 'manual') as RateSource;
      if (!RATE_SOURCES.includes(source)) {
        return NextResponse.json({ error: `Невідоме джерело курсу: ${source}` }, { status: 400 });
      }
      if (source === 'cnb' && base !== 'CZK') {
        return NextResponse.json(
          { error: 'Курс ČNB рахується до крони — він не підходить готелю, який веде облік не в CZK' },
          { status: 400 });
      }
      clean.push({ code, rateSource: source });
    }

    await setSecondaryCurrencies(actor.organizationId, clean);
    return NextResponse.json({ ok: true, secondary: await secondaryCurrencies(actor.organizationId) });
  } catch (e: any) {
    return serverError('PUT /api/settings/currencies', e);
  }
});

/**
 * Вписати курс руками.
 *
 * Пишеться в `finance_exchange_rates` — туди ж, куди пише крон. Один запит
 * відповідає «скільки коштує євро», хоч би хто вніс число; інакше екран
 * мусив би знати, який із двох курсів сьогодні чинний, і одного дня помилився б.
 */
export const saveManualRate = withPermission('manage_properties', async (request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const body = await request.json().catch(() => ({}));
    const code = String(body.code ?? '').trim().toUpperCase();
    const rate = Number(body.rate);
    // `todayFor`, а не годинник сервера: у Празі перша година доби, у Києві
    // до третьої. Курс, внесений о 00:30, отримав би вчорашню дату — і
    // фактура, виписана за хвилину після нього, порахувалась би вчорашнім.
    const date = String(body.date ?? '').trim() || await todayFor(actor.organizationId);

    if (!/^[A-Z]{3}$/.test(code)) {
      return NextResponse.json({ error: 'Код валюти має бути з трьох літер' }, { status: 400 });
    }
    if (!isFinite(rate) || rate <= 0) {
      return NextResponse.json({ error: 'Курс має бути додатним числом' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Дата курсу має бути у форматі РРРР-ММ-ДД' }, { status: 400 });
    }

    const base = await organizationCurrency(actor.organizationId);
    if (code === base) {
      return NextResponse.json({ error: `${code} — основна валюта, курс до себе завжди 1` }, { status: 400 });
    }

    const declared = await declaredCurrency(actor.organizationId, code);
    // Курс валюти, якої немає в списку, нікуди не потрапить: жоден екран її
    // не показує. Мовчазний запис створив би рядок, який ніхто не побачить, —
    // і людина вирішила б, що збереження не працює.
    if (!declared) {
      return NextResponse.json(
        { error: `${code} немає серед валют готелю — спершу додайте її` }, { status: 400 });
    }

    await setManualRate(actor.organizationId, code, base, rate, date);

    return NextResponse.json({ ok: true, rate: await latestRate(actor.organizationId, code, base) });
  } catch (e: any) {
    return serverError('POST /api/settings/currencies/rate', e);
  }
});
