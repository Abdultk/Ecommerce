"use client";

import { useState, type ChangeEvent } from "react";
import { MAX_IMAGE_BYTES, PRESIGN_CONTENT_TYPES, PresignResult } from "@hp/contracts";
import { errorMessage, useSession } from "@/lib/session";
import { nextRowKey, type ImageRow } from "./product-form-model";

const MAX_IMAGES = 12;
const ACCEPTED: readonly string[] = PRESIGN_CONTENT_TYPES;

export type ImagesUpdater = (change: (images: ImageRow[]) => ImageRow[]) => void;

/** Client-side check matching PresignInput, so bad files never get an upload URL. */
export function imageProblem(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return "Use a JPG, PNG, WebP or AVIF image.";
  if (file.size > MAX_IMAGE_BYTES) return "Images must be 8 MB or smaller.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

const move = (list: ImageRow[], from: number, to: number): ImageRow[] => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

type ImageUploaderProps = {
  images: readonly ImageRow[];
  onChange: ImagesUpdater;
  readOnly?: boolean;
};

/**
 * presign → PUT the file straight to storage → keep the returned key. The product
 * save sends { key, alt, position }; order here is the position.
 */
export function ImageUploader({ images, onChange, readOnly = false }: ImageUploaderProps) {
  const { api } = useSession();
  const [messages, setMessages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);

  async function upload(file: File): Promise<string | null> {
    const problem = imageProblem(file);
    if (problem) return `${file.name}: ${problem}`;
    try {
      const { data } = await api.post(
        "/admin/uploads/presign",
        { contentType: file.type, contentLength: file.size },
        PresignResult,
      );
      const put = await fetch(data.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!put.ok) return `${file.name}: Upload failed (HTTP ${put.status}). Try again.`;
      onChange((current) => [
        ...current,
        { rowKey: nextRowKey(), key: data.key, url: data.publicUrl, alt: "" },
      ]);
      return null;
    } catch (err) {
      return `${file.name}: ${errorMessage(err)}`;
    }
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const room = MAX_IMAGES - images.length;
    const accepted = files.slice(0, Math.max(0, room));
    const skipped = files.length - accepted.length;
    setUploading((n) => n + accepted.length);
    const results = await Promise.all(
      accepted.map(async (file) => {
        const result = await upload(file);
        setUploading((n) => n - 1);
        return result;
      }),
    );
    setMessages([
      ...results.filter((m): m is string => m !== null),
      ...(skipped > 0 ? [`A product can have at most ${MAX_IMAGES} images.`] : []),
    ]);
  }

  const setAlt = (rowKey: string, alt: string) =>
    onChange((current) => current.map((img) => (img.rowKey === rowKey ? { ...img, alt } : img)));

  return (
    <div className="space-y-3">
      {images.length > 0 && (
        <ol className="space-y-2">
          {images.map((img, i) => (
            <li
              key={img.rowKey}
              className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-paper p-2"
            >
              {/* Decorative preview; the alt text field below describes the image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                width={56}
                height={56}
                className="size-14 rounded border border-line bg-surface object-cover"
              />
              <div className="min-w-48 flex-1">
                <label htmlFor={`alt-${img.rowKey}`} className="field-label">
                  Alt text, image {i + 1}
                  {i === 0 && <span className="ml-1 font-normal text-muted">(main image)</span>}
                </label>
                <input
                  id={`alt-${img.rowKey}`}
                  value={img.alt}
                  maxLength={200}
                  disabled={readOnly}
                  placeholder="Describe what the photo shows"
                  onChange={(e) => setAlt(img.rowKey, e.target.value)}
                  className="field field-compact"
                />
              </div>
              {!readOnly && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={i === 0}
                    onClick={() => onChange((c) => move(c, i, i - 1))}
                  >
                    <span aria-hidden>↑</span>
                    <span className="sr-only">Move image {i + 1} up</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={i === images.length - 1}
                    onClick={() => onChange((c) => move(c, i, i + 1))}
                  >
                    <span aria-hidden>↓</span>
                    <span className="sr-only">Move image {i + 1} down</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => onChange((c) => c.filter((x) => x.rowKey !== img.rowKey))}
                  >
                    Remove<span className="sr-only"> image {i + 1}</span>
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {!readOnly && (
        <div className="relative rounded-md border border-dashed border-line-strong bg-paper px-4 py-5 text-center text-sm hover:border-ink-400 has-[:focus-visible]:border-ember-600">
          <label
            htmlFor="product-images"
            className="cursor-pointer font-medium text-ink-950 underline decoration-ember-700/40 underline-offset-4 after:absolute after:inset-0"
          >
            Add images
          </label>
          <p id="product-images-hint" className="mt-1 text-xs text-muted">
            JPG, PNG, WebP or AVIF, up to 8 MB each. The first image is the main one.
          </p>
          <input
            id="product-images"
            type="file"
            multiple
            accept={ACCEPTED.join(",")}
            aria-describedby="product-images-hint"
            onChange={(e) => void handleFiles(e)}
            className="sr-only"
          />
        </div>
      )}
      <div aria-live="polite" className="space-y-1 text-sm">
        {uploading > 0 && <p className="text-muted">Uploading {uploading} image(s)…</p>}
        {messages.map((m) => (
          <p key={m} className="error-text">
            {m}
          </p>
        ))}
      </div>
    </div>
  );
}
