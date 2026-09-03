'use client';

/**
 * Область обʼєкта — один стан на всю оболонку.
 *
 * ── Чим це ламалося ─────────────────────────────────────────────────────
 *
 * 03.09.2026: вісім екранів читали «який обʼєкт», і кожен тримав власний
 * `useState('')` з `setPropertyId(arr[0].id)` — щоразу перший. З одним
 * готелем непомітно; з двома оператор на кожному екрані починав із чужого
 * готелю, і ціни, поставлені не тому обʼєкту, їхали в менеджер каналів і на
 * Booking. Тиха втрата грошей, лише цього разу в інтерфейсі.
 *
 * ── Як тепер ─────────────────────────────────────────────────────────────
 *
 * Стан один, тут. Вибір — у шапці (`PropertySwitcher`), екран лише читає
 * `usePropertyScope()`. Екран налаштувань, якому потрібен рівно один обʼєкт,
 * загортається в `<PropertyRequired>`; списки приймають «Усі обʼєкти».
 *
 * Де живе значення, у порядку старшинства:
 *
 *   1. адреса вкладки — `?property=<id>` або `?property=all`. Головна, бо
 *      дві вкладки на два готелі — саме сценарій людини з двома готелями,
 *      і спільна кука змусила б їх битися; посилання з областю можна
 *      переслати колезі;
 *   2. кука `property_scope` — ПАМʼЯТАЄ останній вибір, підставляється,
 *      коли в адресі нічого немає (нова вкладка). Пише `POST /api/auth/property`,
 *      читає `/api/auth/me`;
 *   3. «Усі обʼєкти» — коли не памʼятаємо нічого. Ніколи не «перший».
 *
 * З одним обʼєктом область — завжди він: обирати нема з чого, перемикача
 * немає, адреса не змінюється. Чужий або видалений id в адресі чи куці — не
 * вибір (інваріант 13), а не помилка.
 *
 * Це презентація, не безпека: орендар лежить на сесії й зʼєднанні, політики
 * бази обʼєкта не знають. API-маршрути далі приймають `property_id` явно —
 * змінилося лише те, ХТО його визначає. Тримає `check-property-scope.mjs`:
 * власний стан області поза цим файлом валить збірку.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export interface ScopedProperty {
  id: string;
  name: string;
  /** Курортний збір за дорослого за ніч — форма броні підставляє ставку ОБРАНОГО обʼєкта. */
  city_tax_per_night?: number | null;
}

export interface PropertyScope {
  /** Обʼєкти організації в порядку створення. */
  properties: ScopedProperty[];
  /** Обраний обʼєкт; `null` — «Усі обʼєкти». З одним обʼєктом — завжди він. */
  propertyId: string | null;
  property: ScopedProperty | null;
  /** Обрати (`null` — усі): стан, адреса вкладки, кука. */
  setPropertyId: (id: string | null) => void;
  /**
   * Перечитати список із `/api/auth/me` — після створення чи видалення
   * обʼєкта. `select` — що обрати після перечитування (id або `null`).
   */
  refresh: (select?: string | null) => Promise<void>;
}

/** Параметр адреси й значення «усі обʼєкти». */
export const PROPERTY_PARAM = 'property';
export const ALL_PROPERTIES = 'all';

const PropertyScopeContext = createContext<PropertyScope>({
  properties: [],
  propertyId: null,
  property: null,
  setPropertyId: () => {},
  refresh: async () => {},
});

export function usePropertyScope(): PropertyScope {
  return useContext(PropertyScopeContext);
}

/** Що каже адреса: `undefined` — нічого; `null` — усі; інакше id. */
function scopeFromUrl(): string | null | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = new URLSearchParams(window.location.search).get(PROPERTY_PARAM);
  if (raw === null) return undefined;
  return raw === '' || raw === ALL_PROPERTIES ? null : raw;
}

/**
 * Один обʼєкт — він і є область; далі адреса; далі кука; інакше «усі».
 * Невідомий id (чужий, видалений) пропускається, а не приймається.
 */
export function resolveScope(
  properties: ScopedProperty[],
  remembered: string | null,
  fromUrl: string | null | undefined,
): string | null {
  if (properties.length === 1) return properties[0].id;
  const known = (id: string | null | undefined): id is string => !!id && properties.some((p) => p.id === id);
  if (fromUrl === null) return null;
  if (known(fromUrl)) return fromUrl;
  if (known(remembered)) return remembered;
  return null;
}

function urlWith(id: string | null): string {
  const url = new URL(window.location.href);
  url.searchParams.set(PROPERTY_PARAM, id ?? ALL_PROPERTIES);
  return `${url.pathname}${url.search}${url.hash}`;
}

function remember(id: string | null): void {
  fetch('/api/auth/property', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ property_id: id }),
  }).catch(() => { /* кука — зручність; вкладка вже знає свою область з адреси */ });
}

export function PropertyScopeProvider({
  properties: initial,
  remembered,
  children,
}: {
  properties: ScopedProperty[];
  remembered: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [properties, setProperties] = useState<ScopedProperty[]>(initial);
  const rememberedRef = useRef<string | null>(remembered);
  const [propertyId, setState] = useState<string | null>(() => resolveScope(initial, remembered, scopeFromUrl()));

  // Адреса вкладки завжди називає область, якщо є з чого обирати. Перехід
  // бічним меню губить параметр, і без цього нова адреса читалась би з куки —
  // тобто з ІНШОЇ вкладки. А адреса, яку змінили ззовні (посилання від
  // колеги), навпаки, переважає стан.
  useEffect(() => {
    if (typeof window === 'undefined' || properties.length < 2) return;
    const inUrl = scopeFromUrl();
    if (inUrl === undefined) {
      window.history.replaceState(null, '', urlWith(propertyId));
      return;
    }
    const resolved = resolveScope(properties, rememberedRef.current, inUrl);
    if (resolved !== propertyId) setState(resolved);
  }, [pathname, propertyId, properties]);

  // «Назад» і «вперед» міняють адресу, не міняючи pathname.
  useEffect(() => {
    const onPop = () => setState(resolveScope(properties, rememberedRef.current, scopeFromUrl()));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [properties]);

  const setPropertyId = useCallback((id: string | null) => {
    const next = id && properties.some((p) => p.id === id) ? id : null;
    setState(next);
    rememberedRef.current = next;
    if (typeof window !== 'undefined' && properties.length > 1) {
      window.history.replaceState(null, '', urlWith(next));
    }
    remember(next);
  }, [properties]);

  const refresh = useCallback(async (select?: string | null) => {
    let me: { properties?: unknown; property?: unknown } | null = null;
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return;
      me = await res.json();
    } catch {
      return;
    }
    const next: ScopedProperty[] = Array.isArray(me?.properties) ? (me!.properties as ScopedProperty[]) : [];
    const known: string | null = typeof me?.property === 'string' ? me.property : null;
    setProperties(next);
    rememberedRef.current = known;
    const chosen = select === undefined
      ? resolveScope(next, known, propertyId)
      : resolveScope(next, known, select);
    setState(chosen);
    if (select !== undefined) {
      if (typeof window !== 'undefined' && next.length > 1) window.history.replaceState(null, '', urlWith(chosen));
      rememberedRef.current = chosen;
      remember(chosen);
    }
  }, [propertyId]);

  const value = useMemo<PropertyScope>(() => ({
    properties,
    propertyId,
    property: properties.find((p) => p.id === propertyId) ?? null,
    setPropertyId,
    refresh,
  }), [properties, propertyId, setPropertyId, refresh]);

  return <PropertyScopeContext.Provider value={value}>{children}</PropertyScopeContext.Provider>;
}
