"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  AccountSession,
  CustomerPreferences,
  type CustomerChangePasswordInput,
  type CustomerPreferencesUpdate,
  type DeleteAccountInput,
} from "@hp/contracts";
import { browserApi } from "./api";
import { authStore } from "./auth-store";
import { useAuth } from "./use-auth";

const Nothing = z.null();
const Sessions = z.array(AccountSession);
// The export is a plain document for the customer to keep, so it is not shaped further.
const ExportDocument = z.record(z.string(), z.unknown());

export const settingsKeys = {
  preferences: (userId: string | undefined) => ["preferences", userId] as const,
  sessions: (userId: string | undefined) => ["sessions", userId] as const,
};

// ---------- Preferences ----------

export function usePreferences() {
  const { user } = useAuth();
  return useQuery({
    queryKey: settingsKeys.preferences(user?.id),
    enabled: Boolean(user),
    queryFn: async () => (await browserApi.get("/me/preferences", CustomerPreferences)).data,
  });
}

export function useSavePreferences() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CustomerPreferencesUpdate) =>
      (await browserApi.put("/me/preferences", input, CustomerPreferences)).data,
    onSuccess: (saved) => queryClient.setQueryData(settingsKeys.preferences(user?.id), saved),
  });
}

// ---------- Password and devices ----------

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: CustomerChangePasswordInput) => {
      await browserApi.post("/me/password", input, Nothing);
    },
  });
}

export function useSessions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: settingsKeys.sessions(user?.id),
    enabled: Boolean(user),
    queryFn: async () => (await browserApi.get("/me/sessions", Sessions)).data,
  });
}

export function useSignOutDevice() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await browserApi.delete(`/me/sessions/${encodeURIComponent(id)}`, Nothing);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.sessions(user?.id) }),
  });
}

export function useSignOutOtherDevices() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await browserApi.post("/me/sessions/revoke-others", {}, Nothing);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.sessions(user?.id) }),
  });
}

// ---------- Privacy ----------

export function useExportData() {
  return useMutation({
    mutationFn: async () => (await browserApi.get("/me/export", ExportDocument)).data,
  });
}

/** On success the account is gone: drop the in-memory session and every cached customer query. */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteAccountInput) => {
      await browserApi.post("/me/delete", input, Nothing);
    },
    onSuccess: () => {
      authStore.clear();
      queryClient.clear();
    },
  });
}
