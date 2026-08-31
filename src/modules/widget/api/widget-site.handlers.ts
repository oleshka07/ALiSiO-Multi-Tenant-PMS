/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { hasFeature, featureDisabled } from '@core/features';
import { connectedPaymentProvider } from '@core/payments';
import { withSite } from '../data/site.repo';
import { organizationLanguage } from '@core/i18n/resolve';
import { asWidgetLang } from '../ui/widget-language';

// Колонка `currency` тут NOT NULL, тож `|| 'CZK'` не спрацьовував ніколи —
// це не захист, а вигляд рішення: читач вірив, що порожня валюта буває.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function getWidgetSiteConfigOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function getWidgetSiteConfig(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let slug = searchParams.get('slug');
    
    if (!slug) {
      return NextResponse.json({ error: 'slug is required' }, { status: 400, headers: CORS_HEADERS });
    }
    
    const sql = getSql();
    // Accepts an id, a slug, or the hostname the widget is embedded on — the
    // last of which used to be one hardcoded alias for the first customer.
    // withSite both finds it and makes everything below run as its hotel: the
    // rest of this handler reads that hotel's rooms, prices and payment
    // settings, and under row-level security a guest has no tenant of its own.
    return (await withSite(slug, async (site: any) => {
    if (!await hasFeature(site.organization_id, 'booking_engine')) {
      return featureDisabled('booking_engine', CORS_HEADERS);
    }

    // Whether this hotel can be paid online — asked, not assumed.
    //
    // This was `const hasPayment = false`, a literal standing in for «the Teya
    // integration was removed». Honest at the time and inert: nothing about it
    // could ever become true, and the day a gateway shipped somebody would
    // have had to remember this line existed.
    //
    // connectedPaymentProvider() answers from the registry instead. It returns
    // a provider only when the hotel enabled the module, saved keys AND that
    // provider's gateway code exists. The third is false for all of them
    // today, so the value is still false everywhere — but now it is false
    // because of something checkable, and it turns true by itself.
    const payCfg = JSON.parse(site.payment_config || '{}');
    const provider = await connectedPaymentProvider(site.organization_id);
    const hasPayment = !!provider?.live;

    let maxAdults = 2;
    let maxChildren = 2;
    try {
      // `sl.is_active` тут не буває: site_listings такої колонки не має на
      // жодному рушії — запит кидав щоразу, catch нижче мовчав, і межі
      // місткості завжди були дефолтними 2/2. Той самий привид уже виловлений
      // у send-confirmation-email.ts; статус сайту вже перевірено вище по
      // site.id, у списках окремого прапорця «активний» немає.
      const maxCap = await sql.row<any>(`
        SELECT MAX(ut.max_adults) as maxA, MAX(ut.max_children) as maxC
        FROM site_listings sl
        JOIN unit_types ut ON sl.unit_type_id = ut.id
        WHERE sl.site_id = ?
      `, [site.id]) as any;
      if (maxCap && maxCap.maxA) maxAdults = maxCap.maxA;
      if (maxCap && maxCap.maxC) maxChildren = maxCap.maxC;
    } catch (e) {
      // ignore
    }

    // The hotel's own language, so the widget has something to fall back to
    // besides the language this product was written in. Not derived from
    // Accept-Language here on purpose: this response is the same for every
    // guest of a site and is cached as such — the browser is read in the
    // browser. See ui/widget-language.ts.
    const orgLang = await organizationLanguage(site.organization_id);

    return NextResponse.json({

      id: site.id,
      name: site.name,
      slug: site.slug,
      title: site.name,
      language: asWidgetLang(orgLang),
      design: JSON.parse(site.design_config || '{}'),
      config: JSON.parse(site.widget_config || '{}'),
      currency: site.currency,
      siteUrl: site.site_url,
      hasPayment,
      // The gateway's own name, for the one line that shows it. Null while
      // nothing is live, so the widget falls back to a neutral heading rather
      // than naming a provider that is not taking the money.
      paymentProvider: provider?.live ? provider.label : null,
      maxAdults,
      maxChildren,
      // Analytics fields — read from widget_config JSON, no DB migration needed
      ...(() => {
        try {
          const cfg = JSON.parse(site.widget_config || '{}');
          return {
            fbPixelId: cfg.fb_pixel_id || null,
            ga4Id: cfg.ga4_id || null,
            tiktokPixelId: cfg.tiktok_pixel_id || null,
            returnUrl: cfg.return_url || cfg.thank_you_url || null,
          };
        } catch { return { fbPixelId: null, ga4Id: null, tiktokPixelId: null, returnUrl: null }; }
      })(),
    }, { headers: CORS_HEADERS });
    })) ?? NextResponse.json({ error: 'Site not found' }, { status: 404, headers: CORS_HEADERS });
  } catch (error: any) {
    console.error('GET /api/booking/site-config error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to fetch site config' }, { status: 500, headers: CORS_HEADERS });
  }
}
