import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookGrid } from "@/components/catalog/BookCard";
import { PageHeader } from "@/components/catalog/PageHeader";
import { PageView } from "@/components/primitives/PageView";
import { Reveal } from "@/components/primitives/Reveal";
import { CATEGORIES, booksByCategory, getCategory } from "@/lib/catalog";
import { routes } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return CATEGORIES.map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = getCategory(slug);
  if (!category) return {};

  return pageMetadata({
    title: `کتاب صوتی ${category.title}`,
    description: category.description,
    path: routes.category(category.slug),
  });
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = getCategory(slug);
  if (!category) notFound();

  const books = booksByCategory(category.slug);

  return (
    <>
      <PageView name="category" metadata={{ slug: category.slug }} />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "کتاب‌ها", path: routes.books() },
          { name: category.title, path: routes.category(category.slug) },
        ]}
        eyebrow="دسته"
        title={`کتاب صوتی ${category.title}`}
        lead={category.description}
        aside={<p className="tnum text-[15px] text-muted">{books.length} عنوان</p>}
      />

      <main className="section-rhythm pt-12">
        <div className="container-k">
          <Reveal amount={0.05}>
            <BookGrid books={books} />
          </Reveal>
        </div>
      </main>
    </>
  );
}
