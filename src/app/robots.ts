import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/** M-15: block the auth-gated portal and API surface; point at the sitemap. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/portal", "/api"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
