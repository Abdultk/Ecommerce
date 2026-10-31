import type { Metadata } from "next";
import { SITE_NAME } from "./json-ld";

export type SeoImage = { url: string; alt?: string };

type PageSeo = {
  title: string;
  description: string;
  /** Canonical path (no filter params); resolved against metadataBase in the root layout. */
  path: string;
  images?: readonly SeoImage[];
};

/**
 * Canonical URL plus Open Graph and Twitter cards. Next replaces (not merges) a parent's
 * openGraph object, so every page passes the full set, including the site name.
 */
export function pageMetadata({ title, description, path, images = [] }: PageSeo): Metadata {
  const ogImages = images.slice(0, 4).map(({ url, alt }) => (alt ? { url, alt } : { url }));
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title,
      description,
      ...(ogImages.length ? { images: ogImages } : {}),
    },
    twitter: {
      card: ogImages.length ? "summary_large_image" : "summary",
      title,
      description,
      ...(ogImages.length ? { images: ogImages.map((i) => i.url) } : {}),
    },
  };
}
