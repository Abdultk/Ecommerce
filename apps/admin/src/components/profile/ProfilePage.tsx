"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { ProfileUpdate, type AdminProfile } from "@hp/contracts";
import { FormStatus, SettingsSection, TextField } from "@/components/settings/shared";
import { useEndpoints } from "@/lib/store-settings";
import { errorMessage } from "@/lib/session";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const PROFILE_KEY = ["admin", "me"] as const;

export function ProfilePage() {
  const endpoints = useEndpoints();
  const query = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: async () => (await endpoints.adminMe.get()).data,
  });
  if (query.isPending) return <p className="text-sm text-muted">Loading your profile…</p>;
  if (query.isError || !query.data) {
    return (
      <p role="alert" className="error-text panel p-4">
        {errorMessage(query.error)}
      </p>
    );
  }
  const profile = query.data;
  return (
    <div className="space-y-6">
      <SettingsSection title="Your name" description={`Signed in as ${profile.email}.`}>
        <NameForm profile={profile} />
      </SettingsSection>
      <SettingsSection
        title="Change password"
        description="Enter your current password and a 2FA code. Your other devices are signed out."
      >
        <ChangePasswordForm />
      </SettingsSection>
      <SettingsSection
        title="Other devices"
        description="Sign out every other browser where you're signed in. This one stays signed in."
      >
        <SignOutOthers />
      </SettingsSection>
    </div>
  );
}

function NameForm({ profile }: { profile: AdminProfile }) {
  const endpoints = useEndpoints();
  const queryClient = useQueryClient();
  const ids = useId();
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const body = {
      ...(firstName !== profile.firstName && { firstName }),
      ...(lastName !== profile.lastName && { lastName }),
    };
    if (Object.keys(body).length === 0) {
      setNotice("Nothing changed.");
      return;
    }
    const parsed = ProfileUpdate.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your name.");
      return;
    }
    try {
      await endpoints.adminMe.update(parsed.data);
      await queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
      setNotice("Name saved.");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <TextField
        id={`${ids}-first`}
        label="First name"
        value={firstName}
        autoComplete="given-name"
        onChange={setFirstName}
      />
      <TextField
        id={`${ids}-last`}
        label="Last name"
        value={lastName}
        autoComplete="family-name"
        onChange={setLastName}
      />
      <div className="sm:col-span-2">
        <FormStatus notice={notice} error={error} />
      </div>
    </form>
  );
}

function SignOutOthers() {
  const endpoints = useEndpoints();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signOutOthers = async () => {
    setNotice(null);
    setError(null);
    try {
      await endpoints.adminMe.revokeOtherSessions();
      setNotice("Other devices were signed out.");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn btn-secondary" onClick={signOutOthers}>
        Sign out other devices
      </button>
      {notice && (
        <p role="status" className="text-sm text-ink-700">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  );
}
