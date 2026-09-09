import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { PageView } from "@/components/primitives/PageView";
import { Reveal } from "@/components/primitives/Reveal";
import { BLOG_POSTS, formatDate, getBlogPost } from "@/lib/catalog";
import { absolute, routes } from "@/lib/routes";
import { JsonLd, SITE_NAME, breadcrumbLd, pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};

  return pageMetadata({
    title: post.title,
    description: post.excerpt,
    path: routes.blogPost(post.slug),
    type: "article",
    publishedTime: post.date,
  });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const trail = [
    { name: "کتاپاد", path: routes.home() },
    { name: "بلاگ", path: routes.blog() },
    { name: post.title, path: routes.blogPost(post.slug) },
  ];

  return (
    <>
      <PageView name="blog_post" metadata={{ slug: post.slug }} />

      <main className="pt-24 sm:pt-32 md:pt-40">
        {/* An article is a single column of prose, so it is set to a measure
            rather than to the page grid — ~68ch, which is where Persian body
            text at this size stops needing a ruler to find the next line. */}
        <article className="container-k">
          <div className="mx-auto max-w-[68ch]">
            <Breadcrumbs trail={trail} />

            <Reveal amount={0.05} className="mt-8">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-faint">
                <span className="rounded-full bg-violet-50 px-2.5 py-0.5 font-medium text-violet-700">
                  {post.tag}
                </span>
                <time dateTime={post.date}>{formatDate(post.date)}</time>
                <span className="tnum">{post.readingMinutes} دقیقه مطالعه</span>
              </div>

              <h1 className="mt-4 text-[30px] font-extrabold leading-[1.35] tracking-[-0.015em] text-ink sm:text-[38px] md:text-[44px]">
                {post.title}
              </h1>

              <p className="mt-5 border-r-2 border-violet pr-5 text-[19px] leading-[1.85] text-ink-2">
                {post.excerpt}
              </p>

              <p className="mt-6 text-[15px] text-muted">{post.author}</p>
            </Reveal>

            <Reveal amount={0.05} className="mt-10 flex flex-col gap-6 pb-24">
              {post.body.map((paragraph, i) => (
                <p key={i} className="text-[18px] leading-[2.05] text-ink-2">
                  {paragraph}
                </p>
              ))}
            </Reveal>
          </div>
        </article>
      </main>

      <JsonLd data={breadcrumbLd(trail)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.excerpt,
          url: absolute(routes.blogPost(post.slug)),
          datePublished: post.date,
          dateModified: post.date,
          inLanguage: "fa-IR",
          author: { "@type": "Organization", name: post.author },
          publisher: { "@type": "Organization", name: SITE_NAME },
          mainEntityOfPage: {
            "@type": "WebPage",
            "@id": absolute(routes.blogPost(post.slug)),
          },
          wordCount: post.body.join(" ").split(/\s+/).length,
        }}
      />
    </>
  );
}
