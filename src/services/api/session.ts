import { useEffect } from 'react';
import { create } from 'zustand';
import { resetQueryCache } from '@/app/QueryProvider';
import { useBranchStore } from '@/store/branchStore';
import { apiRequest, ApiClientError, setCredentialProvider } from './http';

export type ApiAuthMode = 'development-fixture' | 'oidc';

export interface ApiSession {
  user: { id: string; displayName: string };
  role: { code: string };
  permissions: string[];
  organization: { id: string; name: string };
  branchScope: { allBranches: boolean; branchId: string | null };
  authMode: ApiAuthMode;
}

export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error' | 'not-configured';

interface DevSessionResponse {
  token: string;
  expiresAt: string;
  user: { id: string; displayName: string; authMode: string };
}

/** Frontend auth mode. Development builds use the dev fixture unless `VITE_AUTH_MODE=oidc`; production builds use OIDC. */
export function configuredAuthMode(): ApiAuthMode {
  const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env ?? {};
  const explicit = env.VITE_AUTH_MODE;
  if (explicit === 'oidc') return 'oidc';
  if (explicit === 'development-fixture') return 'development-fixture';
  return env.DEV === true ? 'development-fixture' : 'oidc';
}

export const OIDC_NOT_CONFIGURED_MESSAGE = 'OIDC sign-in is not configured for this build.';

// The token lives in module memory only. It is never written to localStorage or sessionStorage.
let accessToken: string | null = null;
let tokenExpiresAtMs = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<ApiSession | null> | null = null;

/** Refresh this long before the token expires. */
export const REFRESH_LEEWAY_MS = 60_000;

interface SessionState {
  status: SessionStatus;
  session: ApiSession | null;
  error: string | null;
  authMode: ApiAuthMode;
  /** True while the signed-in identity is the development fixture; screens show a visible "Dev Fixture Auth" badge. */
  devFixtureAuth: boolean;
}

export const useSessionStore = create<SessionState>()(() => ({
  status: 'idle',
  session: null,
  error: null,
  authMode: configuredAuthMode(),
  devFixtureAuth: false,
}));

function clearTimer() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

function scheduleRefresh() {
  clearTimer();
  const delay = Math.max(5_000, tokenExpiresAtMs - Date.now() - REFRESH_LEEWAY_MS);
  refreshTimer = setTimeout(() => {
    void fetchDevToken().catch(() => undefined);
  }, delay);
}

/** Obtains a short-lived dev token and keeps it in memory. */
async function fetchDevToken(): Promise<void> {
  const res = await apiRequest<DevSessionResponse>('/dev/session', { method: 'POST', anonymous: true });
  accessToken = res.token;
  tokenExpiresAtMs = new Date(res.expiresAt).getTime();
  scheduleRefresh();
}

async function signInWithDevFixture(): Promise<ApiSession> {
  await fetchDevToken();
  return apiRequest<ApiSession>('/session');
}

/** Drops the in-memory credential and session. Clears the query cache. */
export function signOut(): void {
  clearTimer();
  accessToken = null;
  tokenExpiresAtMs = 0;
  inFlight = null;
  useSessionStore.setState({ status: 'idle', session: null, error: null, devFixtureAuth: false });
  resetQueryCache();
}

/** Establishes the session once; concurrent callers share the same attempt. */
export function ensureSession(): Promise<ApiSession | null> {
  const state = useSessionStore.getState();
  if (state.status === 'ready' && state.session) return Promise.resolve(state.session);
  if (inFlight) return inFlight;
  const mode = configuredAuthMode();
  if (mode === 'oidc') {
    useSessionStore.setState({ status: 'not-configured', authMode: 'oidc', error: OIDC_NOT_CONFIGURED_MESSAGE, session: null, devFixtureAuth: false });
    return Promise.resolve(null);
  }
  useSessionStore.setState({ status: 'loading', authMode: mode, error: null });
  inFlight = signInWithDevFixture()
    .then((session) => {
      useSessionStore.setState({ status: 'ready', session, error: null, authMode: session.authMode, devFixtureAuth: session.authMode === 'development-fixture' });
      return session;
    })
    .catch((err: unknown) => {
      accessToken = null;
      clearTimer();
      const message = err instanceof ApiClientError ? err.message : 'Could not start a session';
      useSessionStore.setState({ status: 'error', session: null, error: message, devFixtureAuth: false });
      return null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** The bearer token, refreshed first when it is close to expiry. Null when there is no session. */
export async function getAccessToken(): Promise<string | null> {
  if (!accessToken) return null;
  if (configuredAuthMode() === 'development-fixture' && tokenExpiresAtMs - Date.now() < REFRESH_LEEWAY_MS) {
    try {
      await fetchDevToken();
    } catch {
      return accessToken;
    }
  }
  return accessToken;
}

setCredentialProvider(getAccessToken);

let installed = false;
/**
 * Cancels and clears cached queries whenever the signed-in user, organization or branch selection changes,
 * so one scope's data is never shown under another.
 */
export function installScopeCacheReset(): void {
  if (installed) return;
  installed = true;
  const scopeOf = (s: ApiSession | null) => (s ? `${s.user.id}|${s.organization.id}|${s.branchScope.branchId ?? '*'}` : '');
  let lastSession = scopeOf(useSessionStore.getState().session);
  useSessionStore.subscribe((state) => {
    const next = scopeOf(state.session);
    if (next === lastSession) return;
    const hadSession = lastSession !== '';
    lastSession = next;
    if (hadSession) resetQueryCache();
  });
  let lastBranch = useBranchStore.getState().selectedBranchId;
  useBranchStore.subscribe((state) => {
    if (state.selectedBranchId === lastBranch) return;
    lastBranch = state.selectedBranchId;
    resetQueryCache();
  });
}

/** Starts the session on mount and exposes its state. */
export function useApiSession(): SessionState & { retry: () => void } {
  const state = useSessionStore();
  useEffect(() => {
    installScopeCacheReset();
    void ensureSession();
  }, []);
  return { ...state, retry: () => void ensureSession() };
}

/** Test helper: forget all module state. */
export function resetSessionForTests(): void {
  clearTimer();
  accessToken = null;
  tokenExpiresAtMs = 0;
  inFlight = null;
  useSessionStore.setState({ status: 'idle', session: null, error: null, authMode: configuredAuthMode(), devFixtureAuth: false });
}
