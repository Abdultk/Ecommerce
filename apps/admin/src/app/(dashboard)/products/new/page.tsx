import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ProductForm } from "@/components/products/ProductForm";
import { RequirePermission } from "@/components/ui/NoAccess";

export const metadata: Metadata = { title: "New product" };

export default function NewProductPage() {
  return (
    <RequirePermission perm="product:write" label="New product">
      <PageHeader
        eyebrow="Catalog · New product"
        title="New product"
        description={
          <>
            New products start as drafts.{" "}
            <Link href="/products" className="btn-link">
              Back to products
            </Link>
          </>
        }
      />
      <ProductForm />
    </RequirePermission>
  );
}
