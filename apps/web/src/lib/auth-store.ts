import { AuthSession, type PublicUser } from "@hp/contracts";
import { createApiClient } from "@hp/api-client";
import { API_URL } from "./env";

// The access token lives in module memory only — never localStorage or a readable cookie —
// so an XSS payload cannot lift a long-lived credential. A reload restores the session via
// POST /auth/refresh, which uses the httpOnly refresh cookie (credentials: "include").

export type AuthState = {
  accessToken: string | null;
  user: PublicUser | null;
  /** True once the first silent refresh has settled. */
  ready: boolean;
};

const INITIAL_STATE: AuthState = Object.freeze({ accessToken: null, user: null, ready: false });

let state: AuthState = INITIAL_STATE;
const listeners = new Set<() => void>();

function setState(next: AuthState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Tokenless client: refresh must never recurse through the authed client's 401 handling. */
const authApi = createApiClient(API_URL);

export const authStore = {
  getState: (): AuthState => state,
  getServerState: (): AuthState => INITIAL_STATE,
  getToken: (): string | null => state.accessToken,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setSession(session: AuthSession): void {
    setState({ accessToken: session.accessToken, user: session.user, ready: true });
  },
  /** Keeps the session but swaps in a fresher user (e.g. after a profile edit). */
  setUser(user: PublicUser): void {
    if (state.accessToken) setState({ ...state, user });
  },
  clear(): void {
    setState({ accessToken: null, user: null, ready: true });
  },
  /** Test helper: back to the pre-bootstrap state. */
  reset(): void {
    setState(INITIAL_STATE);
  },
};

let refreshInFlight: Promise<string | null> | null = null;

/** Silent refresh via the httpOnly cookie. Resolves to the new access token, or null when signed out. */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= authApi
    .post("/auth/refresh", {}, AuthSession)
    .then(({ data }) => {
      authStore.setSession(data);
      return data.accessToken;
    })
    .catch(() => {
      authStore.clear();
      return null;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export async function signOut(): Promise<void> {
  try {
    await authApi.post("/auth/logout", {});
  } finally {
    // Even if the server call fails, drop the in-memory token so this tab is signed out.
    authStore.clear();
  }
}

/**
 * Resolves once the session is known (signed in or signed out). Before that, a request
 * would go out without the bearer token and, e.g., add to a fresh guest cart instead of
 * the customer's. Reuses the bootstrap refresh (refreshSession dedupes in-flight calls).
 */
export function whenSessionReady(): Promise<void> {
  if (state.ready) return Promise.resolve();
  return refreshSession().then(() => undefined);
}
