import { FileText } from "lucide-react";
import { PageHeader } from "@/components/catalog/PageHeader";
import { FOOTER } from "@/lib/content";
import { routes } from "@/lib/routes";

/**
 * A legal document that has not been written yet.
 *
 * The footer links to these from every page on the site, so leaving the routes
 * missing meant 58 pages each carrying two 404s. A placeholder is not a great
 * answer, but it is an honest one — and far better than either a dead link or
 * invented legal text, which would be a document users could rely on and nobody
 * had actually agreed to.
 *
 * `noIndex` is set by the callers: an empty document should not be the thing a
 * search engine has on file when the real one is published.
 */
export function PendingDocument({
  title,
  eyebrow,
  path,
  summary,
}: {
  title: string;
  eyebrow: string;
  path: string;
  summary: string;
}) {
  return (
    <>
      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: title, path },
        ]}
        eyebrow={eyebrow}
        title={title}
        lead={summary}
      />

      <main className="section-rhythm pt-12">
        <div className="container-k">
          <div className="mx-auto flex max-w-[64ch] flex-col items-start gap-5 rounded-lg border border-line bg-card p-7 sm:p-9">
            <span className="chip chip-paper" aria-hidden>
              <FileText className="size-5" strokeWidth={1.6} />
            </span>

            <h2 className="text-[22px] font-bold text-ink">این سند هنوز منتشر نشده است</h2>

            <p className="text-[17px] leading-[1.9] text-ink-2">
              متن نهایی در حال تدوین است و پیش از آغاز ارائه عمومی سرویس در همین نشانی منتشر
              می‌شود. تا آن زمان، اگر پرسشی در این باره دارید مستقیم بپرسید — پاسخ می‌دهیم.
            </p>

            <a
              href={`mailto:${FOOTER.contact.email}`}
              className="btn btn-primary"
              dir="ltr"
            >
              {FOOTER.contact.email}
            </a>
          </div>
        </div>
      </main>
    </>
  );
}
