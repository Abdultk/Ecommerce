"use client";

import { useState } from "react";
import Image from "next/image";
import { PieceArt, pieceFor } from "@/components/ui/PieceArt";

type Props = {
  src: string | null;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  /** The product's name, used only to pick which drawn piece stands in for a missing photo. */
  label?: string;
};

/**
 * next/image inside a fixed-ratio parent (no layout shift). When the image is missing
 * or fails to load (the sample CDN is fictional), a drawn placeholder keeps the grid whole.
 */
export function ProductImage({ src, alt, sizes, priority = false, className = "", label }: Props) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    // An empty alt means the image is decorative (e.g. a card whose link already names the
    // product), so the placeholder is hidden from assistive tech rather than an unnamed img.
    const semantics = alt
      ? ({ role: "img", "aria-label": alt } as const)
      : ({ "aria-hidden": true } as const);
    return (
      <div
        {...semantics}
        className={`absolute inset-0 grid place-items-center bg-sage-wash ${className}`}
      >
        <PieceArt piece={pieceFor(label ?? alt)} className="h-[58%] w-[58%]" />
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={`object-cover ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
