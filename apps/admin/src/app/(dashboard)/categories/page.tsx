import type { Metadata } from "next";
import { CategoryManager } from "@/components/categories/CategoryManager";
import { PageHeader } from "@/components/PageHeader";
import { RequirePermission } from "@/components/ui/NoAccess";

export const metadata: Metadata = { title: "Categories" };

export default function CategoriesPage() {
  return (
    <RequirePermission perm="product:read" label="Categories">
      <PageHeader
        eyebrow="Catalog"
        title="Categories"
        description="The storefront's category tree. A category can only be deleted once it has no products or subcategories."
      />
      <CategoryManager />
    </RequirePermission>
  );
}
