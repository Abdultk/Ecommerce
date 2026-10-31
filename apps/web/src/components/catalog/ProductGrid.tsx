import type { ProductSummary } from "@hp/contracts";
import { ProductCard } from "./ProductCard";

type Props = { products: readonly ProductSummary[]; priorityCount?: number };

export function ProductGrid({ products, priorityCount = 0 }: Props) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard product={product} priority={index < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
