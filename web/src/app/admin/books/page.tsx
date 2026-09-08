import type { Metadata } from "next";

import { IngestPanel } from "@/components/admin/IngestPanel";
import { pageMetadata } from "@/lib/seo";

/**
 * The internal content-production panel.
 *
 * It lives in this app rather than in a separate one because it is a single
 * screen against the same API, and a second deployable for one page would cost
 * more to keep alive than it saves. It is kept out of the index, out of the
 * sitemap and out of the header instead — nothing links here.
 */
export const metadata: Metadata = {
  ...pageMetadata({
    title: "پنل تولید محتوا",
    description: "آپلود کتاب و ارسال به خط لوله هوش مصنوعی — ابزار داخلی.",
    path: "/admin/books",
    noIndex: true,
  }),
};

/* The panel reads live state on every open; a cached copy of someone else's
   upload list would be worse than useless. */
export const dynamic = "force-dynamic";

export default function AdminBooksPage() {
  return (
    /* The same top offset every non-landing page uses: the site header is
       fixed, and a page that sets its own padding ends up under it. */
    <main className="container-k pt-24 pb-16 sm:pt-32 sm:pb-20">
      <IngestPanel />
    </main>
  );
}
