import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setAccessTokenGetter, setRefreshHandler } from '../services/api/client.js';
import { authApi } from '../services/api/auth.js';
import { getSurface } from '../utils/host.js';

const AuthContext = createContext(null);

/**
 * Session state. The access token lives only in memory (a closure), never in storage;
 * the httpOnly refresh cookie restores the session on reload. Refreshes are single-flight
 * so parallel 401s trigger one rotation.
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const tokenRef = useRef(null);
  const inflight = useRef(null);
  const [state, setState] = useState({ status: 'loading', me: null });
  const surface = getSurface();

  const setToken = useCallback((t) => {
    tokenRef.current = t;
  }, []);

  const loadMe = useCallback(async () => {
    const me = await authApi.me();
    setState({ status: 'authenticated', me });
    return me;
  }, []);

  const refresh = useCallback(() => {
    inflight.current ??= authApi
      .refresh()
      .then((r) => {
        setToken(r.accessToken);
        return r.accessToken;
      })
      .catch((err) => {
        setToken(null);
        setState({ status: 'anonymous', me: null });
        throw err;
      })
      .finally(() => {
        inflight.current = null;
      });
    return inflight.current;
  }, [setToken]);

  useEffect(() => {
    setAccessTokenGetter(() => tokenRef.current);
    setRefreshHandler(refresh);
    let cancelled = false;
    refresh()
      .then(() => !cancelled && loadMe())
      .catch(() => !cancelled && setState({ status: 'anonymous', me: null }));
    return () => {
      cancelled = true;
    };
  }, [refresh, loadMe]);

  /** Accepts a successful auth response ({ accessToken }) and loads the profile. */
  const establish = useCallback(
    async (result) => {
      setToken(result.accessToken);
      queryClient.clear();
      return loadMe();
    },
    [loadMe, queryClient, setToken],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setToken(null);
      queryClient.clear();
      setState({ status: 'anonymous', me: null });
    }
  }, [queryClient, setToken]);

  const switchTenant = useCallback(
    async (tenantId) => {
      const r = await authApi.switchTenant(tenantId);
      setToken(r.accessToken);
      queryClient.clear();
      return loadMe();
    },
    [loadMe, queryClient, setToken],
  );

  const value = useMemo(() => {
    const me = state.me;
    const perms = new Set(me?.permissions ?? []);
    return {
      ...state,
      surface,
      user: me?.user ?? null,
      isAdmin: (me?.platformRoles ?? []).length > 0,
      activeTenant: me?.memberships?.find((m) => m.id === me.activeTenantId) ?? null,
      can: (p) => perms.has(p),
      establish,
      reloadMe: loadMe,
      logout,
      switchTenant,
    };
  }, [state, surface, establish, loadMe, logout, switchTenant]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
