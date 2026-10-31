"use client";

import { useQuery } from "@tanstack/react-query";
import { Category } from "@hp/contracts";
import { z } from "zod";
import { useSession } from "./session";

export const CATEGORIES_KEY = ["categories"] as const;

/** One tree node with what the admin needs to edit it (the public tree has no parentId). */
export type FlatCategory = {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  /** Index among its siblings, which is the stored position order. */
  position: number;
  depth: number;
  childCount: number;
};

export function flattenCategories(tree: readonly Category[]): FlatCategory[] {
  const walk = (
    nodes: readonly Category[],
    parentId: string | null,
    depth: number,
  ): FlatCategory[] =>
    nodes.flatMap((c, position) => [
      {
        id: c.id,
        slug: c.slug,
        name: c.name,
        parentId,
        position,
        depth,
        childCount: c.children.length,
      },
      ...walk(c.children, c.id, depth + 1),
    ]);
  return walk(tree, null, 0);
}

/** Ids of a category and everything below it (a category can't move into these). */
export function subtreeIds(flat: readonly FlatCategory[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  flat.forEach((c) => {
    if (c.parentId && ids.has(c.parentId)) ids.add(c.id);
  });
  return ids;
}

/** Option label with depth shown by a dash prefix, readable by screen readers too. */
export const indentLabel = (c: FlatCategory): string => `${"— ".repeat(c.depth)}${c.name}`;

/** The category tree from the public GET /categories (the API has no admin read route). */
export function useCategories() {
  const { api } = useSession();
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: async () => flattenCategories((await api.get("/categories", z.array(Category))).data),
  });
}
