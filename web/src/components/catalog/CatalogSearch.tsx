import { Search } from "lucide-react";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * The catalogue's search box.
 *
 * A plain GET form, not a client-side filter. Three reasons, in order of
 * weight: the result is a real URL that can be linked and shared (and is what
 * the site's `SearchAction` points at); it works with JavaScript disabled or
 * still loading, which on an Iranian mobile network is a meaningful share of
 * first visits; and it keeps every page that renders it a server component.
 *
 * It submits to `/search` rather than back to `/books` so that the catalogue
 * hub can stay static.
 */
export function CatalogSearch({
  defaultValue = "",
  className,
}: {
  defaultValue?: string;
  className?: string;
}) {
  return (
    <form
      action={routes.search()}
      method="get"
      role="search"
      className={cn("relative max-w-xl", className)}
    >
      <label htmlFor="catalog-q" className="sr-only">
        جست‌وجو در کتاب‌ها
      </label>
      <Search
        className="pointer-events-none absolute right-5 top-1/2 size-5 -translate-y-1/2 text-faint"
        strokeWidth={1.8}
        aria-hidden
      />
      <input
        id="catalog-q"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="نام کتاب، نویسنده یا موضوع…"
        className="field pr-13"
      />
    </form>
  );
}
