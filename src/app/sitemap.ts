import type { MetadataRoute } from "next";
import {
  AUTHORS,
  BLOG_POSTS,
  BOOKS,
  CATEGORIES,
  COLLECTIONS,
  DIALECTS,
  PUBLISHERS,
  VOICES,
} from "@/lib/catalog";
import { absolute, routes } from "@/lib/routes";

/**
 * The sitemap, built from the catalogue.
 *
 * The spec asks for this to be generated from the database rather than
 * maintained by hand, and the reason is visible here: every entity type that
 * gained a page above appears in this file exactly once, so a new dialect or a
 * new narrator is discoverable the moment it is added to the data — nobody has
 * to remember a second place to update.
 *
 * Priorities are relative and only meaningful against each other. Book pages
 * outrank taxonomy pages because they are where a search visitor should land;
 * taxonomy pages exist mostly to get books crawled.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const hubs = [
    { path: routes.home(), priority: 1, changeFrequency: "weekly" as const },
    { path: routes.books(), priority: 0.9, changeFrequency: "daily" as const },
    { path: routes.kids(), priority: 0.9, changeFrequency: "weekly" as const },
    { path: routes.ai(), priority: 0.9, changeFrequency: "weekly" as const },
    { path: routes.dialects(), priority: 0.8, changeFrequency: "weekly" as const },
    { path: routes.voices(), priority: 0.7, changeFrequency: "weekly" as const },
    { path: routes.blog(), priority: 0.6, changeFrequency: "weekly" as const },
  ];

  const entities = [
    ...BOOKS.map((b) => ({ path: routes.book(b.slug), priority: 0.8 })),
    ...CATEGORIES.map((c) => ({ path: routes.category(c.slug), priority: 0.6 })),
    ...COLLECTIONS.map((c) => ({ path: routes.collection(c.slug), priority: 0.6 })),
    ...DIALECTS.map((d) => ({ path: routes.dialect(d.slug), priority: 0.7 })),
    ...VOICES.map((v) => ({ path: routes.voice(v.slug), priority: 0.6 })),
    ...AUTHORS.map((a) => ({ path: routes.author(a.slug), priority: 0.5 })),
    ...PUBLISHERS.map((p) => ({ path: routes.publisher(p.slug), priority: 0.4 })),
  ];

  return [
    ...hubs.map((hub) => ({
      url: absolute(hub.path),
      lastModified: now,
      changeFrequency: hub.changeFrequency,
      priority: hub.priority,
    })),
    ...entities.map((entity) => ({
      url: absolute(entity.path),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: entity.priority,
    })),
    /* Posts carry their own date — a blog entry that has not changed in a year
       should say so rather than claim it was modified at build time. */
    ...BLOG_POSTS.map((post) => ({
      url: absolute(routes.blogPost(post.slug)),
      lastModified: new Date(post.date),
      changeFrequency: "yearly" as const,
      priority: 0.5,
    })),
  ];
}
