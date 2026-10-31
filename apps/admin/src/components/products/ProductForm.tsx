"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { AdminProductDetail, ProductStatus, can, type CurrencyCode } from "@hp/contracts";
import { FieldError } from "@/components/ui/NoAccess";
import { indentLabel, useCategories } from "@/lib/categories";
import { statusLabel } from "@/lib/format";
import { PRODUCTS_KEY, productKey } from "@/lib/query-keys";
import { errorMessage, useSession } from "@/lib/session";
import { useStoreCurrency } from "@/lib/store-settings";
import { ImageUploader, type ImagesUpdater } from "./ImageUploader";
import {
  buildPatch,
  emptyForm,
  formFromDetail,
  slugify,
  validateForm,
  type FieldErrors,
  type ProductFormValues,
  type TriState,
} from "./product-form-model";
import { VariantsEditor, type VariantsUpdater } from "./VariantsEditor";

type ProductFormProps = {
  /** Omit to create a product. */
  product?: AdminProductDetail;
  onSaved?: (product: AdminProductDetail) => void;
};

type TextKey = "name" | "slug" | "brand" | "material" | "careInstructions" | "ovenSafeToF";

/** Waits for the store currency so prices are never parsed with the wrong decimals. */
export function ProductForm(props: ProductFormProps) {
  const { currency, isReady } = useStoreCurrency();
  if (!isReady) {
    return (
      <p role="status" className="text-sm text-muted">
        Loading the store currency…
      </p>
    );
  }
  return <ProductFormFields {...props} currency={currency} />;
}

function ProductFormFields({
  product,
  onSaved,
  currency,
}: ProductFormProps & { currency: CurrencyCode }) {
  const { api, user } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const ids = useId();
  const categories = useCategories();
  const [form, setForm] = useState<ProductFormValues>(() =>
    product ? formFromDetail(product, currency) : emptyForm(),
  );
  const [slugEdited, setSlugEdited] = useState(Boolean(product));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canWrite = Boolean(user && can(user.role, "product:write"));
  const readOnly = !canWrite;

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setName = (name: string) =>
    setForm((f) => ({ ...f, name, slug: slugEdited ? f.slug : slugify(name) }));

  const setImages: ImagesUpdater = (change) => setForm((f) => ({ ...f, images: change(f.images) }));
  const setVariants: VariantsUpdater = (change) =>
    setForm((f) => ({ ...f, variants: change(f.variants) }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setFormError(null);
    const result = validateForm(form, currency);
    if (!result.ok) {
      setErrors(result.errors);
      setFormError("Fix the highlighted fields, then save again.");
      return;
    }
    setErrors({});
    const body = product ? buildPatch(result.data, form, product) : result.data;
    if (product && Object.keys(body).length === 0) {
      setNotice("No changes to save.");
      return;
    }
    setSaving(true);
    try {
      const { data } = product
        ? await api.patch(`/admin/products/${product.id}`, body, AdminProductDetail)
        : await api.post("/admin/products", body, AdminProductDetail);
      queryClient.setQueryData(productKey(data.id), data);
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY });
      if (product) onSaved?.(data);
      else router.push(`/products/${data.id}`);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const text = (
    key: TextKey,
    label: string,
    opts: {
      hint?: string;
      mono?: boolean;
      inputMode?: "numeric";
      onValue?: (v: string) => void;
    } = {},
  ) => {
    const id = `${ids}-${key}`;
    const error = errors[key];
    const describedBy = [error && `${id}-error`, opts.hint && `${id}-hint`]
      .filter(Boolean)
      .join(" ");
    return (
      <div>
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        <input
          id={id}
          value={form[key]}
          disabled={readOnly}
          inputMode={opts.inputMode}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => (opts.onValue ?? ((v: string) => set(key, v)))(e.target.value)}
          className={`field${opts.mono ? " font-mono" : ""}`}
        />
        {opts.hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
            {opts.hint}
          </p>
        )}
        <FieldError id={`${id}-error`} message={error} />
      </div>
    );
  };

  const tri = (key: "dishwasherSafe" | "inductionCompatible", label: string) => (
    <div>
      <label htmlFor={`${ids}-${key}`} className="field-label">
        {label}
      </label>
      <select
        id={`${ids}-${key}`}
        value={form[key]}
        disabled={readOnly}
        onChange={(e) => set(key, e.target.value as TriState)}
        className="field"
      >
        <option value="">Not specified</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </div>
  );

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-6" aria-busy={saving || undefined}>
      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          {text("name", "Product name", { onValue: setName })}
          {text("slug", "Slug", {
            mono: true,
            hint: "Used in the storefront URL.",
            onValue: (v) => {
              setSlugEdited(true);
              set("slug", v);
            },
          })}
          {text("brand", "Brand")}
          <div>
            <label htmlFor={`${ids}-category`} className="field-label">
              Category
            </label>
            <select
              id={`${ids}-category`}
              value={form.categoryId}
              disabled={readOnly}
              aria-invalid={errors.categoryId ? true : undefined}
              aria-describedby={errors.categoryId ? `${ids}-category-error` : undefined}
              onChange={(e) => set("categoryId", e.target.value)}
              className="field"
            >
              <option value="">
                {categories.isPending ? "Loading categories…" : "Choose a category"}
              </option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {indentLabel(c)}
                </option>
              ))}
            </select>
            <FieldError id={`${ids}-category-error`} message={errors.categoryId} />
          </div>
          <div>
            <label htmlFor={`${ids}-status`} className="field-label">
              Status
            </label>
            <select
              id={`${ids}-status`}
              value={form.status}
              disabled={readOnly}
              onChange={(e) => set("status", e.target.value as ProductStatus)}
              className="field"
            >
              {ProductStatus.options.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      <Section title="Storefront copy">
        <label htmlFor={`${ids}-description`} className="field-label">
          Description
        </label>
        <textarea
          id={`${ids}-description`}
          rows={6}
          value={form.description}
          disabled={readOnly}
          aria-describedby={`${ids}-description-hint`}
          onChange={(e) => set("description", e.target.value)}
          className="field py-2 font-mono text-sm"
        />
        <p id={`${ids}-description-hint`} className="mt-1 text-xs text-muted">
          HTML is allowed (paragraphs, lists, emphasis). It is sanitized by the server when you
          save, so scripts and inline event handlers are removed.
        </p>
        <FieldError id={`${ids}-description-error`} message={errors.description} />
      </Section>

      <Section title="Material and care">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {text("material", "Material")}
          {text("ovenSafeToF", "Oven safe to (°F)", { inputMode: "numeric" })}
          {tri("dishwasherSafe", "Dishwasher safe")}
          {tri("inductionCompatible", "Induction compatible")}
          <div className="sm:col-span-2">{text("careInstructions", "Care instructions")}</div>
        </div>
      </Section>

      <Section title="Images">
        <ImageUploader images={form.images} onChange={setImages} readOnly={readOnly} />
      </Section>

      <Section title="Variants">
        <VariantsEditor
          rows={form.variants}
          errors={errors}
          onChange={setVariants}
          currency={currency}
          readOnly={readOnly}
        />
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {formError && (
          <p role="alert" className="error-text">
            {formError}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted">
            {notice}
          </p>
        )}
        {canWrite ? (
          <button type="submit" className="btn btn-primary ml-auto" disabled={saving}>
            {saving ? "Saving…" : product ? "Save changes" : "Create product"}
          </button>
        ) : (
          <p className="ml-auto text-sm text-muted">Your role can view but not edit products.</p>
        )}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="panel p-4 sm:p-5">
      <h2 id={id} className="eyebrow mb-3 text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}
