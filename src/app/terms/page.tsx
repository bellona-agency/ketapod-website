import type { Metadata } from "next";
import { PendingDocument } from "@/components/catalog/PendingDocument";
import { PageView } from "@/components/primitives/PageView";
import { routes } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "قوانین و شرایط",
  description: "قوانین و شرایط استفاده از کتاپاد — در حال تدوین.",
  path: routes.terms(),
  noIndex: true,
});

export default function TermsPage() {
  return (
    <>
      <PageView name="terms" />
      <PendingDocument
        eyebrow="سند"
        title="قوانین و شرایط"
        path={routes.terms()}
        summary="شرایط استفاده از سرویس، حقوق محتوا، اشتراک و بازگشت وجه."
      />
    </>
  );
}
