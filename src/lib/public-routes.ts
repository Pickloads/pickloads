/**
 * The canonical list of public routes.
 *
 * EXTRACTED FROM `seo.ts` so it can be imported without the i18n runtime.
 * `seo.ts` imports `getPathname` from next-intl's navigation, which reaches
 * `next/navigation` — fine in a page, fatal in a plain unit test. The search
 * index and its tests need this list and nothing else from that module, and a
 * list of strings should not require a router to read.
 *
 * `seo.ts` re-exports it, so every existing import keeps working.
 *
 * This is also the definition of "public" that the sitemap AND the search
 * index both derive from. One list, one meaning.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/about",
  "/shippers",
  "/faq",
  "/blog",
  "/knowledge-base",
  "/downloads",
  "/carrier-resources",
  "/careers",
  "/partners",
  "/login-center",
  "/contact",
  /* M-73: the /track LOOKUP FORM is a legitimate public landing page and is
   * indexable. Individual tracking RESULTS are not, and cannot be: they have
   * no URL (the lookup is a POST server action) and `TrackingResult` renders
   * `noindex, nofollow` while one is on screen. Adding this route therefore
   * adds one page per locale to the sitemap and zero shipment data. */
  "/track",
  /* The primary acquisition page. Indexable and canonical: it is the
     destination the site's loudest call to action points at, and a
     conversion page missing from the sitemap is a conversion page search
     engines have to guess at. Its own e2e suite asserts it is listed. */
  "/request-a-quote",
  /* The dispatch pillar's hub. The equipment and state pages remain and are
     unchanged; this is the page they link into, and the one that ranks for
     the service itself rather than for a lane or a trailer type. */
  "/dispatch-services",
  "/become-a-carrier",
  "/start-your-trucking-company",
  "/truck-dispatch",
] as const;
