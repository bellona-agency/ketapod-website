import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/catalog/PageHeader";
import { PageView } from "@/components/primitives/PageView";
import { RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import { BLOG_POSTS, formatDate } from "@/lib/catalog";
import { routes } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "بلاگ",
  description:
    "یادداشت‌های تیم کتاپاد درباره ساخت یک پلتفرم صوتی فارسی — تصمیم‌های فنی، محصول و محتوا.",
  path: routes.blog(),
});

export default function BlogPage() {
  /* Newest first. Sorted here rather than in the seed so the data file stays a
     record of what exists, not of what order it should appear in. */
  const posts = [...BLOG_POSTS].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <PageView name="blog" />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "بلاگ", path: routes.blog() },
        ]}
        eyebrow="یادداشت‌ها"
        title="چطور ساخته می‌شود"
        lead="تصمیم‌هایی که پشت محصول گرفته می‌شوند و دلیلشان — از بیت‌ریت و ترنسکریپت تا سیاست کودک و کاتالوگ گویش‌ها."
      />

      <main className="section-rhythm pt-12">
        <div className="container-k">
          <RevealGroup as="ul" className="flex flex-col gap-4" stagger={0.06} amount={0.05}>
            {posts.map((post) => (
              <RevealItem as="li" key={post.slug}>
                <Link href={routes.blogPost(post.slug)} className="lift card group block p-6 sm:p-8">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-faint">
                    <span className="rounded-full bg-violet-50 px-2.5 py-0.5 font-medium text-violet-700">
                      {post.tag}
                    </span>
                    <span>{formatDate(post.date)}</span>
                    <span className="tnum">{post.readingMinutes} دقیقه مطالعه</span>
                  </div>

                  <h2 className="mt-3 max-w-[34ch] text-[22px] font-bold leading-[1.45] text-ink transition-colors duration-200 group-hover:text-violet sm:text-[26px]">
                    {post.title}
                  </h2>

                  <p className="mt-2.5 max-w-[64ch] text-[16px] leading-[1.85] text-muted">
                    {post.excerpt}
                  </p>
                </Link>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </main>
    </>
  );
}
