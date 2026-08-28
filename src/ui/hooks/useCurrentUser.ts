'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UserRole } from '@/types/database';
import type { Permission } from '@core/auth/permissions';

export interface CurrentUser {
  id: string;
  organization_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  permissions: Permission[];
}

export interface CurrentOrganization {
  currency: string;
  /** Distinct countries of the organization's properties — jurisdiction-bound
   *  UI (Evidenční kniha, currency labels) reads this, never assumes. */
  countries: string[];
}

interface UseCurrentUserReturn {
  user: CurrentUser | null;
  /** Enabled integrations for the user's organization — see core/features.ts. */
  features: Record<string, boolean>;
  organization: CurrentOrganization | null;
  loading: boolean;
  error: string | null;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useCurrentUser(): UseCurrentUserReturn {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [organization, setOrganization] = useState<CurrentOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setFeatures(data.features || {});
        setOrganization(data.organization || null);
        setError(null);
      } else {
        setUser(null);
        if (res.status !== 401) {
          setError('Failed to fetch user');
        }
      }
    } catch {
      setUser(null);
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      window.location.href = '/app/login';
    } catch {
      // ignore
    }
  }, []);

  return { user, features, organization, loading, error, logout, refresh: fetchUser };
}

/**
 * Валюта цього готелю, для екрана.
 *
 * ── Навіщо окремий хук ──────────────────────────────────────────────────
 *
 * Замість `row.currency || 'CZK'`, якого в коді було 69 місць. Кожне з них
 * казало: «якщо база не назвала валюти, це чеські крони». Для чеського готелю
 * непомітно; для німецького це сума в євро з підписом CZK — 4200 EUR і
 * 4200 CZK різні гроші, різні зобовʼязання і різний податок на фактурі.
 *
 * Порожній рядок, поки `/api/auth/me` не відповів, — навмисно. Сума без
 * підпису валюти читається як незавершене завантаження; сума з ЧУЖИМ підписом
 * читається як факт. Це той самий інваріант 17 іншими словами: ціни, якої
 * немає, не існує — а валюти, якої не назвали, не вигадуємо.
 *
 * `organizations.default_currency` — NOT NULL, тож після завантаження тут
 * завжди щось є.
 */
export function useHotelCurrency(): string {
  const { organization } = useCurrentUser();
  return organization?.currency ?? '';
}
