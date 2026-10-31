import type { Category } from "@hp/contracts";

export type CategoryMatch = { category: Category; parent: Category | null };

/** Depth-first lookup that also returns the parent, for breadcrumbs. */
export function findCategory(
  tree: readonly Category[],
  slug: string,
  parent: Category | null = null,
): CategoryMatch | null {
  for (const node of tree) {
    if (node.slug === slug) return { category: node, parent };
    const found = findCategory(node.children, slug, node);
    if (found) return found;
  }
  return null;
}

export function flattenCategories(tree: readonly Category[]): Category[] {
  return tree.flatMap((node) => [node, ...flattenCategories(node.children)]);
}
