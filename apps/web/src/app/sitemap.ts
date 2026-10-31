import type { MetadataRoute } from "next";
import { serverApi } from "@/lib/server-api";
import { buildSitemap } from "@/lib/sitemap";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap(serverApi);
}
