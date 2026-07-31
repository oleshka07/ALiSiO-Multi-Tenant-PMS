'use client';

/**
 * Behaviour layer for the marketing site.
 *
 * The design ships as one HTML file whose interactions are written against the
 * DOM: elements carry `data-*` markers and a script wires them up. The markup
 * is generated into server components (good for SEO and for keeping the design
 * as the source of truth), so the interactions stay DOM-driven here rather
 * than being rewritten as React state — the markers are the contract.
 *
 * Two things are deliberately not ported: the hash router, replaced by real
 * Next routes, and the accent-colour prop, which is now a CSS variable.
 */

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const ACCENT = '#3DDCC0';

type Cleanup = () => void;

// ─── decision ledger ─────────────────────────────────────────────────────────
const LEDGER_ROWS: [string, string, string, string, string, string][] = [
  ['06:12', 'Rate', 'Fri 15.08 €142 → €168', 'pace +31% vs LY, festival in town', '+€289', 'ok'],
  ['09:40', 'Tetris', 'Upgrade to unit 7', 'frees a 4-night block 12–15', '+€180', 'ok'],
  ['11:05', 'Inbox', 'Replied in DE about parking', 'FAQ, confidence 0.94', '−6 min', 'ok'],
  ['13:22', 'Money', 'Card #4412 retried', 'first attempt: insufficient funds', '€340', 'ok'],
  [
    '16:50',
    'Upsell',
    'Late checkout €25 offered',
    'next arrival 18:00, guest flies late',
    'declined',
    'neutral',
  ],
  ['22:00', 'Compliance', '6 foreign guests filed', '24h obligation', 'confirmed', 'ok'],
  [
    '23:40',
    'Housekeeping',
    'Route re-sequenced for Fri',
    '2 early arrivals detected',
    '−35 min',
    'ok',
  ],
  [
    '02:15',
    'Channel',
    'Parity gap closed on 3 dates',
    'Expedia lagged 40 min',
    'risk cleared',
    'ok',
  ],
];

// ─── autonomy levels L0–L5 ───────────────────────────────────────────────────
const DIAL_LEVELS: [string, string][] = [
  [
    'Observer',
    'Watches and gathers statistics. Shows nothing, changes nothing. An intern in week one.',
  ],
  ['Advisor', 'Writes a suggestion into the feed. You read it whenever you feel like it.'],
  [
    'Drafter',
    'Prepares the fully formed action. One tap and it is done. An assistant bringing a document to sign.',
  ],
  [
    'Act with undo',
    'Acts on its own, tells you immediately, and leaves a two-hour cancellation window on every move. Like an experienced manager you trust with the day.',
  ],
  [
    'Act quietly',
    'Acts and records to the Ledger. You read it in the daily briefing. You already trust it.',
  ],
  ['Owns the KPI', 'Sets its own sub-goals inside your budget and policy. You hired a director.'],
];

// ─── translations for [data-i18n] nodes ──────────────────────────────────────
const DICT: Record<string, Record<string, string>> = {
  en: {},
  uk: {
    nav_product: 'Продукт',
    nav_agents: 'AI-екіпаж',
    nav_solutions: 'Рішення',
    nav_integrations: 'Інтеграції',
    nav_cases: 'Клієнти',
    nav_blog: 'Блог',
    nav_about: 'Компанія',
    nav_demo: 'Замовити демо',
    cta_demo: 'Замовити демо',
    cta_shadow: 'Запустити Shadow Mode, 14 днів, безкоштовно',
    cta_watch: 'Історія за 90 секунд',
    hero_h1: 'Подивіться, скільки ваш об’єкт втратив минулого місяця.',
    hero_sub:
      'Alisio, це повноцінна система управління об’єктом із цифровим екіпажем поверх неї: ціни, відповіді гостям, покоївки, платежі та комплаєнс. Підключіть у режимі «лише читання» на 14 днів: система приймає всі рішення, не виконує жодного, і видає вам детальний чек на те, скільки вона б заробила.',
  },
  de: {
    nav_product: 'Produkt',
    nav_agents: 'KI-Crew',
    nav_solutions: 'Lösungen',
    nav_integrations: 'Integrationen',
    nav_cases: 'Kunden',
    nav_blog: 'Blog',
    nav_about: 'Unternehmen',
    nav_demo: 'Demo buchen',
    cta_demo: 'Demo buchen',
    cta_shadow: 'Shadow Mode starten, 14 Tage, kostenlos',
    cta_watch: 'Die 90-Sekunden-Story',
    hero_h1: 'Sehen Sie, was Ihr Haus letzten Monat verloren hat.',
    hero_sub:
      'Alisio ist ein vollständiges Property-Management-System mit einer digitalen Crew darüber: Preise, Gästeantworten, Housekeeping, Zahlungen, Compliance. Schließen Sie es 14 Tage lesend an: es entscheidet alles, führt nichts aus und übergibt Ihnen eine detaillierte Abrechnung dessen, was es verdient hätte.',
  },
  cs: {
    nav_product: 'Produkt',
    nav_agents: 'AI tým',
    nav_solutions: 'Řešení',
    nav_integrations: 'Integrace',
    nav_cases: 'Klienti',
    nav_blog: 'Blog',
    nav_about: 'Společnost',
    nav_demo: 'Domluvit demo',
    cta_demo: 'Domluvit demo',
    cta_shadow: 'Spustit Shadow Mode, 14 dní zdarma',
    cta_watch: 'Příběh na 90 sekund',
    hero_h1: 'Podívejte se, o co váš objekt minulý měsíc přišel.',
    hero_sub:
      'Alisio je kompletní hotelový systém s digitální posádkou navrch: ceny, odpovědi hostům, úklid, platby a compliance. Připojte ho na 14 dní pouze pro čtení: rozhodne o všem, nic nevykoná a předá vám podrobný účet toho, co by vydělal.',
  },
};

function all<T extends HTMLElement = HTMLElement>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector));
}

function one<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

// ─── reveal on scroll + count-up numbers ─────────────────────────────────────
function initReveal(): Cleanup {
  const counted = new WeakSet<HTMLElement>();

  const countUp = (el: HTMLElement) => {
    if (counted.has(el)) return;
    counted.add(el);
    const to = Number.parseFloat(el.getAttribute('data-count-to') ?? '0') || 0;
    const started = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - started) / 1100);
      el.textContent = String(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const show = (el: HTMLElement) => {
    el.style.opacity = '1';
    el.style.transform = 'none';
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const target = entry.target as HTMLElement;
        show(target);
        for (const counter of all('[data-count-to]')) {
          if (target.contains(counter)) countUp(counter);
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
  );

  for (const el of all('[data-reveal]')) observer.observe(el);

  // Anything already on screen must not wait for a scroll that may never come.
  const revealVisible = () => {
    for (const el of all('[data-reveal]')) {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.96 && rect.bottom > 0) show(el);
    }
  };
  const first = window.setTimeout(revealVisible, 60);
  const safety = window.setTimeout(() => {
    for (const el of all('[data-reveal]')) show(el);
  }, 2600);

  return () => {
    observer.disconnect();
    clearTimeout(first);
    clearTimeout(safety);
  };
}

// ─── header dropdowns ────────────────────────────────────────────────────────
function initDropdowns(): Cleanup {
  const header = one('[data-nav]');
  if (!header) return () => {};

  const closeAll = () => {
    for (const panel of all('[data-drop-panel]')) panel.style.display = 'none';
  };

  const disposers: Cleanup[] = [];

  for (const trigger of all('[data-drop]')) {
    const key = trigger.getAttribute('data-drop');
    const panel = one(`[data-drop-panel="${key}"]`);
    if (!panel) continue;
    const open = () => {
      closeAll();
      panel.style.display = 'block';
    };
    trigger.addEventListener('mouseenter', open);
    trigger.addEventListener('click', open);
    disposers.push(() => {
      trigger.removeEventListener('mouseenter', open);
      trigger.removeEventListener('click', open);
    });
  }

  header.addEventListener('mouseleave', closeAll);

  const onScroll = () => {
    header.style.background = window.scrollY > 40 ? 'rgba(8,9,11,.94)' : 'rgba(8,9,11,.72)';
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // A route change has to close whatever was hovered open.
  const onNavigate = (event: Event) => {
    if ((event.target as HTMLElement | null)?.closest?.('a')) closeAll();
  };
  document.addEventListener('click', onNavigate);

  return () => {
    for (const dispose of disposers) dispose();
    header.removeEventListener('mouseleave', closeAll);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('click', onNavigate);
  };
}

// ─── language switcher ───────────────────────────────────────────────────────
/**
 * Both of these outlive a route change on purpose. The header is rendered by
 * the layout and is never remounted, so re-reading "original" copy off the DOM
 * on the second navigation would capture already-translated text — and the
 * chosen language has to survive the navigation that follows it.
 */
const originalCopy = new Map<string, string>();
let chosenLanguage = 'en';

function applyLanguage(code: string): void {
  const dict = DICT[code] ?? {};
  for (const el of all('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (!key) continue;
    const text = dict[key] ?? originalCopy.get(key);
    if (text) el.textContent = text;
  }
  const current = one('[data-lang-current]');
  if (current) current.textContent = code.toUpperCase();
  document.documentElement.lang = code;
}

function initLanguage(): Cleanup {
  const button = one('[data-lang-btn]');
  const menu = one('[data-lang-menu]');
  const current = one('[data-lang-current]');
  if (!button || !menu || !current) return () => {};

  // The English copy ships in the markup — capture it once, before anything
  // has had a chance to overwrite it.
  for (const el of all('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (key && !originalCopy.has(key)) originalCopy.set(key, el.textContent ?? '');
  }

  // The dashboard's root layout declares lang="uk"; this site is English until
  // the visitor says otherwise.
  applyLanguage(chosenLanguage);

  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  };
  const close = () => {
    menu.style.display = 'none';
  };

  button.addEventListener('click', toggle);
  document.addEventListener('click', close);

  const disposers: Cleanup[] = [];
  for (const option of all('[data-lang-opt]')) {
    const code = option.getAttribute('data-lang-opt') ?? 'en';
    const enter = () => {
      option.style.background = 'rgba(255,255,255,.06)';
    };
    const leave = () => {
      option.style.background = 'transparent';
    };
    const pick = () => {
      chosenLanguage = code;
      applyLanguage(code);
    };
    option.addEventListener('mouseenter', enter);
    option.addEventListener('mouseleave', leave);
    option.addEventListener('click', pick);
    disposers.push(() => {
      option.removeEventListener('mouseenter', enter);
      option.removeEventListener('mouseleave', leave);
      option.removeEventListener('click', pick);
    });
  }

  return () => {
    button.removeEventListener('click', toggle);
    document.removeEventListener('click', close);
    for (const dispose of disposers) dispose();
  };
}

// ─── tab groups ──────────────────────────────────────────────────────────────
function initTabs(): Cleanup {
  const disposers: Cleanup[] = [];

  for (const group of all('[data-tabs]')) {
    const buttons = Array.from(group.querySelectorAll<HTMLElement>('[data-tab-btn]'));
    const panels = Array.from(group.querySelectorAll<HTMLElement>('[data-tab-panel]'));

    for (const button of buttons) {
      const select = () => {
        const key = button.getAttribute('data-tab-btn');
        for (const other of buttons) {
          const on = other === button;
          other.style.background = on ? ACCENT : 'transparent';
          other.style.color = on ? '#07100E' : '#B6BCC3';
          other.style.fontWeight = on ? '600' : '400';
        }
        for (const panel of panels) {
          const on = panel.getAttribute('data-tab-panel') === key;
          panel.style.display = on ? 'grid' : 'none';
          if (!on) continue;
          panel.style.opacity = '0';
          panel.style.transform = 'translateY(10px)';
          panel.style.transition = 'opacity .45s ease,transform .45s ease';
          requestAnimationFrame(() => {
            panel.style.opacity = '1';
            panel.style.transform = 'none';
          });
        }
      };
      button.addEventListener('click', select);
      disposers.push(() => button.removeEventListener('click', select));
    }
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}

// ─── decision ledger autoplay ────────────────────────────────────────────────
function initLedger(): Cleanup {
  const box = one('[data-ledger]');
  if (!box) return () => {};

  const renderRow = (row: (typeof LEDGER_ROWS)[number]) => {
    const good = row[5] === 'ok';
    const el = document.createElement('div');
    el.style.cssText =
      'border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:11px 13px;background:rgba(255,255,255,.025);animation:dcx-lgIn .55s cubic-bezier(.2,.7,.2,1)';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    const time = document.createElement('span');
    time.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#5F676E";
    time.textContent = row[0];
    const tag = document.createElement('span');
    tag.style.cssText = `font-size:11.5px;color:${good ? ACCENT : '#9BA3AB'};border:1px solid ${
      good ? 'rgba(61,220,192,.3)' : 'rgba(255,255,255,.14)'
    };border-radius:99px;padding:2px 8px`;
    tag.textContent = row[1];
    const title = document.createElement('span');
    title.style.cssText = 'font-size:14px;font-weight:500;flex:1 1 auto';
    title.textContent = row[2];
    const value = document.createElement('span');
    value.style.cssText = `font-size:13.5px;font-weight:600;color:${good ? ACCENT : '#7F888F'}`;
    value.textContent = row[4];
    head.append(time, tag, title, value);
    const why = document.createElement('div');
    why.style.cssText = 'margin-top:5px;font-size:12.5px;color:#6F787F';
    why.textContent = row[3];
    el.append(head, why);
    return el;
  };

  box.innerHTML = '';
  let index = 0;
  for (; index < 5; index++) box.appendChild(renderRow(LEDGER_ROWS[index]));

  const timer = window.setInterval(() => {
    const row = LEDGER_ROWS[index % LEDGER_ROWS.length];
    index++;
    box.insertBefore(renderRow(row), box.firstChild);
    while (box.children.length > 5) box.removeChild(box.lastChild as Node);
  }, 3200);

  return () => clearInterval(timer);
}

// ─── autonomy dial ───────────────────────────────────────────────────────────
function initDial(): Cleanup {
  const dial = one<HTMLInputElement>('[data-dial]');
  if (!dial) return () => {};

  const update = () => {
    const value = Number(dial.value);
    dial.style.setProperty('--fill', `${(value / 5) * 100}%`);
    const level = one('[data-dial-level]');
    const name = one('[data-dial-name]');
    const desc = one('[data-dial-desc]');
    const meta = one('[data-dial-meta]');
    if (level) level.textContent = `L${value}`;
    if (name) name.textContent = DIAL_LEVELS[value][0];
    if (desc) desc.textContent = DIAL_LEVELS[value][1];
    if (meta) meta.style.opacity = value === 0 ? '.35' : '1';
  };

  dial.addEventListener('input', update);
  update();
  return () => dial.removeEventListener('input', update);
}

// ─── booking tape ────────────────────────────────────────────────────────────
function initBookingTape(): Cleanup {
  const detail = one('[data-booking-detail]');
  if (!detail) return () => {};

  const cells = all('[data-cell]');
  const disposers: Cleanup[] = [];

  for (const cell of cells) {
    const enter = () => {
      cell.style.filter = 'brightness(1.25)';
    };
    const leave = () => {
      cell.style.filter = 'none';
    };
    const select = () => {
      for (const other of cells) other.style.outline = 'none';
      cell.style.outline = `2px solid ${ACCENT}`;
      cell.style.outlineOffset = '1px';
      detail.textContent = cell.getAttribute('data-bk');
      detail.style.color = '#ECEAE5';
    };
    cell.addEventListener('mouseenter', enter);
    cell.addEventListener('mouseleave', leave);
    cell.addEventListener('click', select);
    disposers.push(() => {
      cell.removeEventListener('mouseenter', enter);
      cell.removeEventListener('mouseleave', leave);
      cell.removeEventListener('click', select);
    });
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}

// ─── parallax ────────────────────────────────────────────────────────────────
function initParallax(): Cleanup {
  const elements = all('[data-parallax]');
  if (!elements.length) return () => {};
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        const factor = Number.parseFloat(el.getAttribute('data-parallax') ?? '0') || 0;
        const offset = (rect.top - window.innerHeight * 0.5) * factor;
        // only once the reveal transition has finished, or it fights the entrance
        if (el.style.opacity === '1') el.style.transform = `translateY(${offset.toFixed(1)}px)`;
      }
      ticking = false;
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  return () => window.removeEventListener('scroll', onScroll);
}

// ─── accordions (FAQ, module lists) ──────────────────────────────────────────
function initAccordions(): Cleanup {
  const disposers: Cleanup[] = [];

  for (const item of all('[data-acc]')) {
    const head = item.querySelector<HTMLElement>('[data-acc-head]');
    const body = item.querySelector<HTMLElement>('[data-acc-body]');
    if (!head || !body) continue;
    head.style.cursor = 'pointer';
    const toggle = () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      const icon = item.querySelector<HTMLElement>('[data-acc-icon]');
      if (icon) icon.style.transform = open ? 'none' : 'rotate(45deg)';
    };
    head.addEventListener('click', toggle);
    disposers.push(() => head.removeEventListener('click', toggle));
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}

// ─── demo form ───────────────────────────────────────────────────────────────
function initForm(): Cleanup {
  const disposers: Cleanup[] = [];

  for (const chip of all('[data-chip]')) {
    const toggle = () => {
      const on = Boolean(chip.style.background) && chip.style.background !== 'none';
      chip.style.background = on ? 'transparent' : 'rgba(61,220,192,.1)';
      chip.style.borderColor = on ? 'rgba(255,255,255,.12)' : 'rgba(61,220,192,.45)';
      chip.style.color = on ? '#B6BCC3' : '#ECEAE5';
    };
    chip.addEventListener('click', toggle);
    disposers.push(() => chip.removeEventListener('click', toggle));
  }

  for (const field of all<HTMLInputElement>('.dcx-root input, .dcx-root textarea')) {
    const focus = () => {
      field.style.borderColor = ACCENT;
    };
    const blur = () => {
      field.style.borderColor = 'rgba(255,255,255,.12)';
    };
    field.addEventListener('focus', focus);
    field.addEventListener('blur', blur);
    disposers.push(() => {
      field.removeEventListener('focus', focus);
      field.removeEventListener('blur', blur);
    });
  }

  const submit = one('[data-submit]');
  const note = one('[data-form-note]');
  if (submit && note) {
    const send = () => {
      submit.textContent = 'Thank you, we would be in touch';
      submit.style.background = 'transparent';
      submit.style.border = `1px solid ${ACCENT}`;
      submit.style.color = ACCENT;
      note.textContent =
        'Prototype only: nothing was sent. In the live product this creates a lead in the CRM pipeline.';
    };
    submit.addEventListener('click', send);
    disposers.push(() => submit.removeEventListener('click', send));
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}

// ─── mobile navigation ───────────────────────────────────────────────────────
function initMobileNav(): Cleanup {
  const burger = one('[data-burger]');
  const panel = one('[data-mobile-menu]');
  if (!burger || !panel) return () => {};

  const close = () => {
    panel.style.display = 'none';
  };
  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  };

  burger.addEventListener('click', toggle);
  const links = Array.from(panel.querySelectorAll('a'));
  for (const link of links) link.addEventListener('click', close);

  return () => {
    burger.removeEventListener('click', toggle);
    for (const link of links) link.removeEventListener('click', close);
  };
}

// ─── responsive collapse ─────────────────────────────────────────────────────
/**
 * The design styles everything inline, and inline styles cannot carry media
 * queries — so the breakpoints are applied in script, exactly as the design
 * does. Original values are stashed on the element so widening the window
 * restores them.
 */
function initResponsive(): Cleanup {
  const apply = () => {
    const w = window.innerWidth;
    const narrow = w < 1080;
    const tiny = w < 720;
    const mobile = w < 980;

    const burger = one('[data-burger]');
    if (burger) burger.style.display = mobile ? 'flex' : 'none';
    if (!mobile) {
      const panel = one('[data-mobile-menu]');
      if (panel) panel.style.display = 'none';
    }

    const navCta = one('[data-nav-cta]');
    if (navCta) navCta.style.display = w < 560 ? 'none' : 'block';

    if (mobile) {
      for (const panel of all('[data-drop-panel]')) panel.style.display = 'none';
    }

    const headRow = one('[data-nav] > div');
    if (headRow) headRow.style.padding = tiny ? '0 16px' : '0 28px';

    // page gutters
    for (const el of all(
      '.dcx-root main [style*="padding:"], .dcx-root footer [style*="padding:"]',
    )) {
      if (!el.dataset.pad) el.dataset.pad = el.style.padding || 'none';
      const pad = el.dataset.pad;
      if (pad === 'none' || !pad.includes('28px')) continue;
      el.style.padding = tiny ? pad.replace(/28px/g, '16px') : pad;
    }

    // the booking tape scrolls sideways instead of being crushed
    const tape = one('[data-grid]');
    if (tape?.parentElement) {
      const host = tape.parentElement;
      if (mobile) {
        tape.style.minWidth = '780px';
        host.style.overflowX = 'auto';
      } else {
        tape.style.minWidth = '';
        host.style.overflowX = '';
      }
    }

    // full-width tap targets for primary actions on phones
    for (const el of all('.dcx-root main a[data-route], .dcx-root main [data-submit]')) {
      if (!el.dataset.disp) el.dataset.disp = el.style.display || 'none';
      const isButton =
        (el.style.background || '').startsWith('var(--acc') ||
        (el.style.border || '').startsWith('1px solid rgba(255,255,255,.1');
      if (!isButton || !el.style.padding) continue;
      if (w < 620) {
        el.style.display = 'block';
        el.style.textAlign = 'center';
        el.style.width = '100%';
        el.style.boxSizing = 'border-box';
        if (Number.parseFloat(el.style.padding) < 15) el.style.padding = '15px 20px';
      } else {
        el.style.display = el.dataset.disp === 'none' ? '' : el.dataset.disp;
        el.style.width = '';
        el.style.textAlign = '';
      }
    }

    // oversized display type gets a phone ceiling
    for (const el of all('.dcx-root main h1, .dcx-root main h2')) {
      if (!el.dataset.fs) el.dataset.fs = el.style.fontSize || 'none';
      const size = el.dataset.fs;
      if (size === 'none' || !size.includes('clamp')) continue;
      el.style.fontSize =
        w < 620
          ? size.replace(/clamp\((\d+)px/, (_, px: string) => `clamp(${Math.min(Number(px), 32)}px`)
          : size;
    }

    for (const el of all('.dcx-root main [style*="grid-template-columns"]')) {
      if (el.dataset.gtc === undefined) el.dataset.gtc = el.style.gridTemplateColumns;
      const original = el.dataset.gtc;
      if (!original) continue;
      // never touch fixed-track mock grids (booking tape, quick-create, device mocks)
      if (original.includes('px') || el.closest('[data-grid]')) continue;
      if (!original.includes('1fr') && !original.includes('repeat')) continue;

      let cols: number;
      if (tiny) cols = 1;
      else if (narrow)
        cols = original.includes('repeat(4') || original.includes('repeat(3') ? 2 : 1;
      else cols = 0;

      el.style.gridTemplateColumns = cols ? (cols === 1 ? '1fr' : `repeat(${cols},1fr)`) : original;

      for (const child of Array.from(el.children) as HTMLElement[]) {
        if (!child.dataset.gcol) child.dataset.gcol = child.style.gridColumn || 'none';
        const span = child.dataset.gcol;
        if (span === 'none' || !span.includes('span')) continue;
        child.style.gridColumn = cols ? '1 / -1' : span;
      }
    }

    const nav = one('[data-nav] nav');
    if (nav) nav.style.display = w < 980 ? 'none' : 'flex';
  };

  apply();
  window.addEventListener('resize', apply);
  return () => window.removeEventListener('resize', apply);
}

// ─── nav highlight, driven by the real route ─────────────────────────────────
function highlightNav(pathname: string): void {
  for (const link of all('[data-nav] nav a[href]')) {
    const href = link.getAttribute('href') ?? '';
    const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
    link.style.color = active ? '#ECEAE5' : '#B6BCC3';
  }
}

export default function DesignRuntime() {
  const pathname = usePathname();

  useEffect(() => {
    const cleanups: Cleanup[] = [
      initReveal(),
      initDropdowns(),
      initLanguage(),
      initTabs(),
      initLedger(),
      initDial(),
      initBookingTape(),
      initParallax(),
      initAccordions(),
      initForm(),
      initMobileNav(),
      initResponsive(),
    ];
    highlightNav(pathname);

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [pathname]);

  return null;
}
