"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AdminProductDetail } from "@hp/contracts";
import { Can } from "@/components/Can";
import { PageHeader } from "@/components/PageHeader";
import { TypedConfirmDialog } from "@/components/ui/TypedConfirmDialog";
import { formatDateTime, statusLabel } from "@/lib/format";
import { errorMessage, useSession } from "@/lib/session";
import { PRODUCTS_KEY, productKey } from "@/lib/query-keys";
import { ProductForm } from "./ProductForm";

/** Loads one product for editing, with save feedback and the archive action. */
export function ProductEditor({ id }: { id: string }) {
  const { api } = useSession();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const query = useQuery({
    queryKey: productKey(id),
    queryFn: async () => (await api.get(`/admin/products/${id}`, AdminProductDetail)).data,
  });

  if (query.isPending) {
    return (
      <p role="status" className="text-sm text-muted">
        Loading product…
      </p>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="error-text max-w-xl">
        {errorMessage(query.error)}{" "}
        <button type="button" className="btn btn-link" onClick={() => void query.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const product = query.data;

  async function archive() {
    const { data } = await api.delete(`/admin/products/${product.id}`, AdminProductDetail);
    queryClient.setQueryData(productKey(product.id), data);
    void queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY });
    setArchiving(false);
    setNotice("Product archived. It no longer appears in the storefront.");
  }

  return (
    <>
      <PageHeader
        eyebrow="Catalog · Edit product"
        title={product.name}
        description={
          <>
            {statusLabel(product.status)} · last updated {formatDateTime(product.updatedAt)} ·{" "}
            <Link href="/products" className="btn-link">
              Back to products
            </Link>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {product.status !== "ARCHIVED" && (
          <Can perm="product:delete">
            <button
              type="button"
              className="btn btn-quiet ml-auto"
              onClick={() => setArchiving(true)}
            >
              Archive product
            </button>
          </Can>
        )}
      </div>
      <ProductForm
        // Remount with fresh form state after every save so saved variants become existing ones.
        key={product.updatedAt}
        product={product}
        onSaved={(saved) => {
          queryClient.setQueryData(productKey(saved.id), saved);
          setNotice("Saved.");
        }}
      />
      {archiving && (
        <TypedConfirmDialog
          title="Archive this product?"
          description="Archived products disappear from the storefront. Orders and stock history keep referring to them, and you can set the status back later."
          phrase={product.slug}
          confirmLabel="Archive"
          onConfirm={archive}
          onClose={() => setArchiving(false)}
        />
      )}
    </>
  );
}
