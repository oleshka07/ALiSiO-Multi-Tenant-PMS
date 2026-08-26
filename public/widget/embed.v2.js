/**
 * ALiSiO booking widget — the snippet a hotel puts on its own website.
 *
 * Served from two URLs, ONE file: `/widget/embed.v2.js` is what the interface
 * hands out, `/embed.v2.js` is an older path that some hotels already have in
 * their pages, and next.config.ts rewrites it here. There used to be two real
 * files at those two paths, and they had drifted:
 *
 *   the one hotels were given  — resize, redirect, language, query forwarding
 *   the one at the root        — Meta / GA4 / TikTok pixels, purchase, UTM
 *
 * Neither was a superset. So every hotel that installed the snippet from the
 * interface, filled in its Pixel ID on the site settings screen and waited for
 * conversions got nothing: the widget posts `analytics_config` and `purchase`
 * to the parent page, and the file on that page had no listener for either.
 * The settings fields worked, the tracking never existed. This file is the
 * union, and there is now only one of it.
 */
(function() {
  // 1. Find the script tag that loaded this file
  var script = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  // 2. Get configuration from data attributes
  var siteSlug = script.getAttribute('data-site');
  if (!siteSlug) {
    console.error('ALiSiO Widget Error: data-site attribute is missing.');
    return;
  }

  var unitId = script.getAttribute('data-unit') || '';

  // Works from either URL this file is served at.
  var baseUrl = script.src.replace(/\/(widget\/)?embed\.v2\.js(\?.*)?$/, '');

  /**
   * The language — and, when we do not know one, SILENCE.
   *
   * Must match WIDGET_LANGUAGES in src/modules/widget/ui/widget-language.ts;
   * widget-language.check.ts fails if these two lists drift apart.
   */
  var WIDGET_LANGUAGES = ['uk', 'en', 'cs', 'de'];

  function browserLang() {
    if (typeof navigator === 'undefined' || !navigator.language) return '';
    var two = navigator.language.slice(0, 2).toLowerCase();
    return WIDGET_LANGUAGES.indexOf(two) === -1 ? '' : two;
  }

  // Not passing `lang` at all is a real answer, and the important one.
  //
  // This used to end in `|| 'uk'`, and the resulting `?lang=uk` is the HIGHEST
  // precedence the widget has — above the hotel's own language. So a German
  // hotel using the standard snippet showed its booking form in Ukrainian to
  // every guest whose browser was not one of these four: Polish, Dutch,
  // Italian, French. The widget's own language resolution had already been
  // fixed; this line reached over it from outside and pinned the wrong answer,
  // which is why fixing the widget alone changed nothing on a real site.
  //
  // Omitted, the widget asks /api/booking/site-config and opens in the
  // language the hotel actually set. That is the whole point of the chain.
  var lang = script.getAttribute('data-lang')
    || (typeof window !== 'undefined' && window.__BOOKING_LANG__)
    || browserLang();

  // 3. Create a unique container for the widget
  var container = document.createElement('div');
  container.className = 'alisio-widget-container';
  container.style.width = '100%';
  container.style.position = 'relative';

  // 4. Find where to inject
  var target = document.getElementById('alisio-booking-widget')
    || document.getElementById('alisio-booking-container');

  if (target) {
    // Prevent duplicate injection
    if (target.querySelector('.alisio-widget-container')) {
      console.log('ALiSiO Widget already present in target, skipping.');
      return;
    }
    target.appendChild(container);
  } else if (script && script.parentNode) {
    script.parentNode.insertBefore(container, script);
  } else {
    document.body.appendChild(container);
  }

  // 5. Create the iframe
  var iframe = document.createElement('iframe');
  var queryParams = new URLSearchParams({
    unitId: unitId,
    embed: 'true',
    v: Date.now() // Cache busting
  });
  if (lang) queryParams.set('lang', lang);

  // Forward parent window query params (e.g., promo, checkin, checkout)
  if (typeof window !== 'undefined' && window.location.search) {
    var parentParams = new URLSearchParams(window.location.search);
    parentParams.forEach(function(value, key) {
      if (!queryParams.has(key)) {
        queryParams.set(key, value);
      }
    });
  }

  var url = baseUrl + '/w/' + siteSlug + '?' + queryParams.toString();

  iframe.src = url;
  iframe.style.width = '1px';
  iframe.style.minWidth = '100%';
  iframe.style.height = '1200px'; // Massive initial height
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  iframe.style.overflow = 'hidden';
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('frameborder', '0');

  container.appendChild(iframe);

  // 6. Analytics state (populated via postMessage from inside the iframe)
  var analytics = { fbPixelId: null, ga4Id: null, tiktokPixelId: null, pixelsInjected: false };

  function injectFbPixel(pixelId) {
    if (window.fbq) return;
    var s = document.createElement('script');
    s.innerHTML = '!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version=\'2.0\';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,\'script\',\'https://connect.facebook.net/en_US/fbevents.js\');fbq(\'init\',\'' + pixelId + '\');fbq(\'track\',\'PageView\');';
    document.head.appendChild(s);
  }

  function injectGa4(ga4Id) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ga4Id;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    if (!window.gtag) {
      window.gtag = function() { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
    }
    window.gtag('config', ga4Id);
  }

  function injectTiktokPixel(pixelId) {
    if (window.ttq) return;
    var s = document.createElement('script');
    s.innerHTML = '!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDequeue=function(e){ttq[e]=function(){ttq.instance(ttq._i[0]).then(function(i){i[e].apply(i,arguments)})}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDequeue(ttq.methods[i]);ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js",r=document.createElement("script");r.type="text/javascript",r.async=!0,r.src=i;var s=document.getElementsByTagName("script")[0];s.parentNode.insertBefore(r,s),ttq._i=ttq._i||{},ttq._i[e]=[],ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};for(var a=function(e){return function(){ttq.instance(e).then(function(t){t[e].apply(t,arguments)})}},o=0;o<ttq.methods.length;o++)ttq[ttq.methods[o]]=a(ttq.methods[o])},ttq.load("' + pixelId + '"),ttq.page()}(window,document,"ttq");';
    document.head.appendChild(s);
  }

  // 7. Message listener: resize, redirect, UTM, analytics config, purchase
  window.addEventListener('message', function(e) {
    if (!e.data) return;

    // ── Resize ────────────────────────────────────
    if (e.data.type === 'resize' && e.data.height) {
      // Massive 100px buffer
      var newHeight = parseInt(e.data.height) + 100;
      iframe.style.height = newHeight + 'px';
    }

    // ── Redirect ──────────────────────────────────
    if (e.data.type === 'alisio:redirect' && e.data.url) {
      // Relay to parent — works both when used directly on a page (parent = window)
      // and when loaded inside a srcdoc iframe (parent = the React host window).
      try { parent.postMessage({ type: 'alisio:redirect', url: e.data.url }, '*'); } catch (pe) {}
      // Also navigate this window as fallback for direct (non-iframe) usage
      if (window === parent) { window.location.href = e.data.url; }
    }

    if (!e.data.source || e.data.source !== 'alisio-widget') return;

    // ── UTM request from iframe ───────────────────
    if (e.data.event === 'request_utm') {
      var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid'];
      var own = new URLSearchParams(window.location.search);
      var utm = {};
      UTM_KEYS.forEach(function(k) { var v = own.get(k); if (v) utm[k] = v; });
      if (e.source) {
        e.source.postMessage({ source: 'alisio-parent', event: 'utm_params', utm: utm }, '*');
      }
    }

    // ── Analytics config from iframe ──────────────
    if (e.data.event === 'analytics_config' && !analytics.pixelsInjected) {
      analytics.pixelsInjected = true;
      if (e.data.fbPixelId)     { analytics.fbPixelId = e.data.fbPixelId;         injectFbPixel(e.data.fbPixelId); }
      if (e.data.ga4Id)         { analytics.ga4Id = e.data.ga4Id;                 injectGa4(e.data.ga4Id); }
      if (e.data.tiktokPixelId) { analytics.tiktokPixelId = e.data.tiktokPixelId; injectTiktokPixel(e.data.tiktokPixelId); }
    }

    // ── Purchase event from iframe ────────────────
    if (e.data.event === 'purchase') {
      var val      = e.data.value    || 0;
      var currency = e.data.currency || 'CZK';
      var eventId  = e.data.eventId  || ('booking_' + (e.data.reservationId || Date.now()));

      // Meta Pixel
      if (window.fbq && analytics.fbPixelId) {
        window.fbq('track', 'Purchase', { value: val, currency: currency }, { eventID: eventId });
      }
      // GA4
      if (window.gtag && analytics.ga4Id) {
        window.gtag('event', 'purchase', { transaction_id: e.data.reservationId, value: val, currency: currency });
      }
      // TikTok
      if (window.ttq && typeof window.ttq.track === 'function' && analytics.tiktokPixelId) {
        window.ttq.track('CompletePayment', { value: val, currency: currency, content_id: e.data.reservationId || eventId });
      }
    }
  }, false);

  console.log('ALiSiO Widget V3 Loaded for site:', siteSlug);
})();
