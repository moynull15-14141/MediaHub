import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/src/components/auth/AuthContext';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface PermissionsState {
  role: string | null;
  permissions: Set<string>;
  loading: boolean;
}

// Module-level cache (mirrors the TTL-cache pattern already used server-side
// in template-engine.service.ts / permission.service.ts) so navigating
// between WhatsApp pages doesn't refetch this on every mount. Purely a UX
// nicety - every route is independently enforced server-side regardless of
// what a page does with this ("never trust frontend").
const CACHE_TTL_MS = 30_000;
let cache: { role: string; permissions: Set<string>; expiresAt: number } | null = null;
let inflight: Promise<{ role: string; permissions: string[] }> | null = null;

// Permission Guards (Phase A.3, Part: FRONTEND) - lets a page do
// `const { can } = usePermissions(); ... disabled={!can('settings:write')}`
// without redesigning anything. Future modules can adopt the same hook.
export function usePermissions() {
  const { token } = useAuth();
  const [state, setState] = useState<PermissionsState>(() => ({
    role: cache?.role ?? null,
    permissions: cache?.permissions ?? new Set(),
    loading: !cache,
  }));
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setState({ role: null, permissions: new Set(), loading: false });
      return;
    }
    if (cache && cache.expiresAt > Date.now()) {
      setState({ role: cache.role, permissions: cache.permissions, loading: false });
      return;
    }

    if (!inflight) {
      inflight = whatsappFetch<{ role: string; permissions: string[] }>(token, '/permissions').finally(() => {
        inflight = null;
      });
    }
    inflight
      .then((data) => {
        cache = { role: data.role, permissions: new Set(data.permissions), expiresAt: Date.now() + CACHE_TTL_MS };
        if (mountedRef.current) setState({ role: cache.role, permissions: cache.permissions, loading: false });
      })
      .catch(() => {
        if (mountedRef.current) setState((prev) => ({ ...prev, loading: false }));
      });
  }, [token]);

  const can = (permissionKey: string): boolean => state.permissions.has(permissionKey);

  return { role: state.role, permissions: state.permissions, loading: state.loading, can };
}
