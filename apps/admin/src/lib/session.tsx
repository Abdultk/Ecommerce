"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiClientError, createApiClient, type ApiClient } from "@hp/api-client";
import {
  AcceptInviteInput,
  Admin2faInput,
  AdminChallenge,
  AdminLoginInput,
  AuthSession,
  isAdminRole,
  type LoginInput,
  type PublicUser,
} from "@hp/contracts";
import { z } from "zod";
import { API_URL } from "./config";

export type SessionStatus = "loading" | "authenticated" | "anonymous";
export type SignOutReason = "manual" | "idle" | "expired";

type SessionState = {
  status: SessionStatus;
  user: PublicUser | null;
  /** Step-one result of the admin login, held in memory until the 2FA step completes. */
  challenge: AdminChallenge | null;
  signOutReason: SignOutReason | null;
};

export type SessionValue = SessionState & {
  /** Authenticated client: sends the in-memory access token and refreshes it silently. */
  api: ApiClient;
  startLogin(input: LoginInput): Promise<AdminChallenge>;
  /** Redeems an emailed invite: sets the password and returns the 2FA enrollment challenge. */
  acceptInvite(input: AcceptInviteInput): Promise<AdminChallenge>;
  verifyCode(code: string): Promise<PublicUser>;
  signOut(reason?: SignOutReason): Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

const NOT_ADMIN_MESSAGE = "This account can't use the admin dashboard.";

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

type SessionProviderProps = {
  children: ReactNode;
  apiUrl?: string;
  /** Pre-signed-in session (tests). Production starts empty and restores via refresh. */
  initialSession?: AuthSession;
  /** Try POST /auth/refresh on mount to restore a session after a reload. */
  bootstrap?: boolean;
};

export function SessionProvider({
  children,
  apiUrl = API_URL,
  initialSession,
  bootstrap = true,
}: SessionProviderProps) {
  const queryClient = useQueryClient();
  // The access token lives only in memory: never in storage, never in a cookie readable by JS.
  const tokenRef = useRef<string | null>(initialSession?.accessToken ?? null);
  const bootstrapped = useRef(false);
  const [state, setState] = useState<SessionState>(() => ({
    status: initialSession ? "authenticated" : bootstrap ? "loading" : "anonymous",
    user: initialSession?.user ?? null,
    challenge: null,
    signOutReason: null,
  }));

  const clients = useMemo(() => {
    const publicApi = createApiClient(apiUrl);
    const refresh = async (): Promise<string | null> => {
      try {
        const { data } = await publicApi.post("/auth/refresh", undefined, AuthSession);
        if (!isAdminRole(data.user.role)) throw new Error(NOT_ADMIN_MESSAGE);
        tokenRef.current = data.accessToken;
        setState((s) => ({ ...s, status: "authenticated", user: data.user }));
        return data.accessToken;
      } catch {
        // A failed refresh means the session is over; the guard sends the user to /login.
        // Drop cached orders, customers and audit data so the next person in this tab
        // never sees them.
        tokenRef.current = null;
        queryClient.clear();
        setState((s) => ({
          ...s,
          status: "anonymous",
          user: null,
          signOutReason: s.status === "authenticated" ? "expired" : s.signOutReason,
        }));
        return null;
      }
    };
    const api = createApiClient(apiUrl, { get: () => tokenRef.current, refresh });
    return { publicApi, api, refresh };
  }, [apiUrl, queryClient]);

  useEffect(() => {
    // Guarded so StrictMode's double effect never presents a rotating refresh token twice.
    if (!bootstrap || initialSession || bootstrapped.current) return;
    bootstrapped.current = true;
    void clients.refresh();
  }, [bootstrap, initialSession, clients]);

  const startLogin = useCallback(
    async (input: LoginInput) => {
      const parsed = AdminLoginInput.safeParse(input);
      if (!parsed.success) {
        throw new ApiClientError(400, {
          code: "VALIDATION_ERROR",
          message: firstIssue(parsed.error),
        });
      }
      const { data } = await clients.publicApi.post(
        "/admin/auth/login",
        parsed.data,
        AdminChallenge,
      );
      setState((s) => ({ ...s, challenge: data }));
      return data;
    },
    [clients],
  );

  const acceptInvite = useCallback(
    async (input: AcceptInviteInput) => {
      const parsed = AcceptInviteInput.safeParse(input);
      if (!parsed.success) {
        throw new ApiClientError(400, {
          code: "VALIDATION_ERROR",
          message: firstIssue(parsed.error),
        });
      }
      const { data } = await clients.publicApi.post(
        "/admin/auth/accept-invite",
        parsed.data,
        AdminChallenge,
      );
      setState((s) => ({ ...s, challenge: data }));
      return data;
    },
    [clients],
  );

  const verifyCode = useCallback(
    async (code: string) => {
      const challengeToken = state.challenge?.challengeToken;
      if (!challengeToken) {
        throw new ApiClientError(401, {
          code: "UNAUTHENTICATED",
          message: "Your sign-in expired. Please start again.",
        });
      }
      const parsed = Admin2faInput.safeParse({ challengeToken, code });
      if (!parsed.success) {
        throw new ApiClientError(400, {
          code: "VALIDATION_ERROR",
          message: firstIssue(parsed.error),
        });
      }
      const { data } = await clients.publicApi.post("/admin/auth/2fa", parsed.data, AuthSession);
      if (!isAdminRole(data.user.role)) {
        throw new ApiClientError(403, { code: "FORBIDDEN", message: NOT_ADMIN_MESSAGE });
      }
      tokenRef.current = data.accessToken;
      queryClient.clear(); // a fresh sign-in starts from an empty cache, whoever was here before
      setState({ status: "authenticated", user: data.user, challenge: null, signOutReason: null });
      return data.user;
    },
    [clients, queryClient, state.challenge],
  );

  const signOut = useCallback(
    async (reason: SignOutReason = "manual") => {
      try {
        await clients.api.post("/auth/logout", undefined, z.null());
      } catch {
        // The server may be unreachable; the local session is cleared regardless,
        // and the refresh token expires on its own (8 h).
      }
      tokenRef.current = null;
      queryClient.clear();
      setState({ status: "anonymous", user: null, challenge: null, signOutReason: reason });
    },
    [clients, queryClient],
  );

  const value = useMemo<SessionValue>(
    () => ({ ...state, api: clients.api, startLogin, acceptInvite, verifyCode, signOut }),
    [state, clients, startLogin, acceptInvite, verifyCode, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>.");
  return value;
}

/** User-facing message for any error thrown by the api client or session actions. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError || error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
