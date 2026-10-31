import type { Metadata } from "next";
import { ProductEditor } from "@/components/products/ProductEditor";
import { RequirePermission } from "@/components/ui/NoAccess";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission perm="product:read" label="Products">
      <ProductEditor id={id} />
    </RequirePermission>
  );
}
