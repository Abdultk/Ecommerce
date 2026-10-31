"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";

export function GiftWrapOption() {
  const t = useTranslations("Cart.giftOption");
  const [enabled, setEnabled] = useState(false);
  const [note, setNote] = useState("");
  const checkboxId = useId();
  const noteId = useId();

  return (
    <div className="my-3 rounded-tile border border-line bg-crust p-3.5 shadow-sm transition-all">
      <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-3">
        <input
          id={checkboxId}
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 size-4 rounded accent-ember"
        />
        <div className="flex-1 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-iron">
            <span>🎁</span>
            <span>{t("title")}</span>
          </div>
          <p className="mt-0.5 text-smoke leading-relaxed">{t("subtitle")}</p>
        </div>
      </label>

      {enabled ? (
        <div className="mt-3 border-t border-line/60 pt-2.5 animate-in fade-in">
          <label htmlFor={noteId} className="block text-[11px] font-semibold text-smoke mb-1">
            {t("noteLabel")}
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            rows={2}
            maxLength={200}
            className="w-full rounded-sm border border-line bg-flour p-2 text-xs text-iron focus:border-forest focus:outline-none"
          />
          <div className="mt-1 flex items-center justify-between text-[10px] text-smoke">
            <span>{note.length > 0 ? t("noteSaved") : ""}</span>
            <span>{note.length}/200</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
