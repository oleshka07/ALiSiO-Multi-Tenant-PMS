'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UserRole } from '@/types/database';
import type { Permission } from '@/lib/permissions';

export interface CurrentUser {
  id: string;
  organization_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  permissions: Permission[];
}

interface UseCurrentUserReturn {
  user: CurrentUser | null;
  /** Enabled integrations for the user's organization — see core/features.ts. */
  features: Record<string, boolean>;
  loading: boolean;
  error: string | null;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useCurrentUser(): UseCurrentUserReturn {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setFeatures(data.features || {});
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

  return { user, features, loading, error, logout, refresh: fetchUser };
}
