"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Address } from "@hp/contracts";
import { useAddresses, useDeleteAddress, useSaveAddress } from "@/lib/account";
import { toAddressInput } from "@/lib/address-form";
import { useGovernorateName } from "@/lib/use-governorate-name";
import { errorMessage } from "@/lib/orders";
import { AddressEditor } from "./AddressEditor";

type Editing = { kind: "new" } | { kind: "edit"; id: string } | null;

const label = (a: Address) => `${a.line1}, ${a.city}`;

export function AddressBook() {
  const t = useTranslations("Account.addresses");
  const { data, isPending, isError, error } = useAddresses();
  const [editing, setEditing] = useState<Editing>(null);

  if (isPending) return <div aria-busy="true" className="skeleton h-48" />;
  if (isError) {
    return (
      <p role="alert" className="font-semibold text-danger">
        {errorMessage(error)}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {data.length === 0 && editing === null ? (
        <p className="text-smoke">{t("none")}</p>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {data.map((address) => (
          <li key={address.id}>
            {editing?.kind === "edit" && editing.id === address.id ? (
              <AddressEditor address={address} onDone={() => setEditing(null)} />
            ) : (
              <AddressCard
                address={address}
                onEdit={() => setEditing({ kind: "edit", id: address.id })}
              />
            )}
          </li>
        ))}
      </ul>
      {editing?.kind === "new" ? (
        <AddressEditor onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="btn btn-iron" onClick={() => setEditing({ kind: "new" })}>
          {t("add")}
        </button>
      )}
    </div>
  );
}

function AddressCard({ address, onEdit }: { address: Address; onEdit: () => void }) {
  const t = useTranslations("Account.addresses");
  const governorate = useGovernorateName();
  const save = useSaveAddress();
  const remove = useDeleteAddress();
  const [confirming, setConfirming] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const failure = save.error ?? remove.error;

  // Addresses saved before the move to Oman no longer validate; they need editing first.
  const makeDefault = () => {
    const input = toAddressInput(address, true);
    setOutdated(input === null);
    if (input) save.mutate({ id: address.id, input });
  };

  return (
    <article
      aria-label={label(address)}
      className="h-full space-y-3 rounded-[var(--radius-tile)] bg-crust p-5 shadow-[var(--shadow-plate)]"
    >
      <div className="flex items-start justify-between gap-3">
        <address className="text-sm not-italic">
          <span className="font-semibold">{address.fullName}</span>
          <br />
          {address.line1}
          {address.line2 ? `, ${address.line2}` : ""}
          <br />
          {address.city}, {governorate(address.region)} {address.postalCode}
          {address.phone ? (
            <>
              <br />
              {address.phone}
            </>
          ) : null}
        </address>
        {address.isDefault ? (
          <span className="rounded-full bg-sage-wash px-3 py-1 text-xs font-bold uppercase tracking-wider text-sage">
            {t("default")}
          </span>
        ) : null}
      </div>
      {outdated ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {t("outdated")}
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {errorMessage(failure)}
        </p>
      ) : null}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{t("confirmDelete")}</span>
          <button
            type="button"
            className="btn btn-primary py-1"
            disabled={remove.isPending}
            onClick={() => remove.mutate(address.id)}
          >
            {t("yesDelete")}
          </button>
          <button type="button" className="btn btn-ghost py-1" onClick={() => setConfirming(false)}>
            {t("keep")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost py-1" onClick={onEdit}>
            {t("edit")}
            <span className="sr-only"> {label(address)}</span>
          </button>
          <button type="button" className="btn btn-ghost py-1" onClick={() => setConfirming(true)}>
            {t("delete")}
            <span className="sr-only"> {label(address)}</span>
          </button>
          {address.isDefault ? null : (
            <button
              type="button"
              className="btn btn-ghost py-1"
              disabled={save.isPending}
              onClick={makeDefault}
            >
              {t("makeDefault")}
              <span className="sr-only"> {label(address)}</span>
            </button>
          )}
        </div>
      )}
    </article>
  );
}
