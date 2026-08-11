import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * M-15: block the auth-gated portal and API surface; point at the sitemap.
 *
 * M-76 adds `/driver`. `/driver/update/[token]` is an unauthenticated route
 * that redeems a bearer credential on every render — indexing it would put a
 * live driver link in a search result, and crawling it would burn the §13
 * rate budget and fill the audit ledger with bot traffic. The route also
 * carries `robots: noindex, nofollow, nocache` in its own metadata and is
 * absent from `PUBLIC_ROUTES`, so it is in neither the sitemap nor the
 * crawlable set; this is the third of the three.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/portal", "/api", "/driver"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
