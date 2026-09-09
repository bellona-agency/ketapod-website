import { getAuthor, lowestPrice } from "@/lib/catalog";
import { semanticSearch } from "@/lib/mock/assistant";

/**
 * Natural-language catalogue search.
 *
 * Public and unauthenticated: the spec makes `/ai` the main acquisition funnel,
 * open «بدون نیاز به ورود» with a few free questions before the lead form. A
 * search that demanded a session would close the funnel it exists to open.
 *
 * Nothing here touches a transcript, so there is no entitlement question — this
 * ranks catalogue metadata, which is already public on every book page.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const results = semanticSearch(q);

  return Response.json({
    query: q,
    results: results.map(({ book, score }) => ({
      slug: book.slug,
      title: book.title,
      subtitle: book.subtitle ?? null,
      author: getAuthor(book.authorSlug)?.name ?? null,
      summary: book.summary,
      priceRial: lowestPrice(book),
      score: Math.round(score * 100) / 100,
    })),
    /* Named so nobody reads these results as embeddings. The spec's path is
       Postgres FTS then Meilisearch then pgvector; this is the seam. */
    engine: "lexical",
  });
}
