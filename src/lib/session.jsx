/**
 * THE OPERATOR SESSION, CLIENT SIDE — Phase 13K.
 *
 * One question — "is somebody signed in" — asked once at load and answered by
 * the server. Nothing here decides whether access is allowed: every protected
 * byte comes from an API that requires a session cookie, so this is about
 * which screen to draw, not about permission.
 *
 * WHY THE STATE IS NOT IN localStorage. A flag saying "signed in" is a flag a
 * page can be wrong about, and the wrong direction is the dangerous one: an
 * expired session with a stale flag renders the workspace and then fails every
 * request. The cookie is HttpOnly, so this cannot read it — which is the
 * point. `/api/auth/me` is the only source of truth.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth, onUnauthenticated } from '@/api/client';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [operator, setOperator] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { operator: who } = await auth.me();
      setOperator(who);
      return who;
    } catch {
      // A network failure is not a sign-out: showing the login screen because
      // the server restarted would lose whatever the operator was typing.
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /**
   * Any 401 from anywhere signs the app out — 13K.
   *
   * A session expires while a tab is open, and the operator finds out when
   * something they clicked does nothing. This makes the whole app agree with
   * the server the moment one request disagrees, so the answer is the login
   * screen rather than a silent failure.
   */
  useEffect(() => onUnauthenticated(() => setOperator(null)), []);

  const value = useMemo(() => ({
    operator,
    loading,
    refresh,
    async signIn(email, password) {
      const { operator: who } = await auth.login(email, password);
      setOperator(who);
      return who;
    },
    async signOut() {
      await auth.logout();
      setOperator(null);
    },
  }), [operator, loading, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}
