import type { Metadata } from "next";
import { PendingDocument } from "@/components/catalog/PendingDocument";
import { PageView } from "@/components/primitives/PageView";
import { routes } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "حریم خصوصی",
  description: "سیاست حریم خصوصی کتاپاد — در حال تدوین.",
  path: routes.privacy(),
  /* Not indexable while it is a placeholder: an empty document is not what a
     search engine should have on file when the real one is published. */
  noIndex: true,
});

export default function PrivacyPage() {
  return (
    <>
      <PageView name="privacy" />
      <PendingDocument
        eyebrow="سند"
        title="حریم خصوصی"
        path={routes.privacy()}
        summary="چه داده‌ای جمع می‌شود، چرا، چقدر نگه داشته می‌شود و چطور می‌توانید حذفش کنید."
      />
    </>
  );
}
