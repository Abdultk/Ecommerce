import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/env";
import { buildRobots } from "@/lib/robots";

export default function robots(): MetadataRoute.Robots {
  return buildRobots(SITE_URL);
}
