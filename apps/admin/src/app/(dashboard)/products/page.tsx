import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { ProductsTable } from "@/components/products/ProductsTable";
import { RequirePermission } from "@/components/ui/NoAccess";

export const metadata: Metadata = { title: "Products" };

export default function ProductsPage() {
  return (
    <RequirePermission perm="product:read" label="Products">
      <PageHeader
        eyebrow="Catalog"
        title="Products"
        description="Every product including drafts and archived items. Filters and sort are kept in the address bar, so a view can be bookmarked or shared."
      />
      <ProductsTable />
    </RequirePermission>
  );
}
