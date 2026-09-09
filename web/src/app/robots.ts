import type { MetadataRoute } from "next";
import { SITE_URL, absolute } from "@/lib/routes";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      /*
       * Search results are the one thing here worth keeping out of the index.
       * `/search?q=…` renders real content, so a crawler will happily index
       * thousands of near-identical variants of the catalogue — which competes
       * with `/books` itself and with the very book pages the results link to.
       */
      disallow: [
        "/search",
        /* The content-production panel. It is behind an admin key, but a
           crawler that finds it still wastes budget on a login screen and
           puts an internal tool in the index. */
        "/admin",
      ],
    },
    sitemap: absolute("/sitemap.xml"),
    host: SITE_URL,
  };
}
