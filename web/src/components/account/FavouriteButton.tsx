"use client";

import { Heart, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/components/account/SessionProvider";
import { addFavourite, getFavourites, removeFavourite } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * The heart, for a book page.
 *
 * Dropped into a statically generated page, so it has to fetch its own state
 * after hydration. The whole favourites list is fetched rather than a
 * per-book check: it is one small array, it is already the endpoint the
 * favourites screen uses, and a `GET /favourites/[slug]` would be a second
 * endpoint answering a question the first one already answers.
 *
 * A logged-out visitor still sees the heart, and pressing it sends them to
 * login with the way back. Hiding it would remove the only prompt to sign up
 * that the catalogue has.
 */
export function FavouriteButton({
  bookSlug,
  className,
}: {
  bookSlug: string;
  className?: string;
}) {
  const { me, status } = useSession();
  const router = useRouter();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }
    let cancelled = false;
    (async () => {
      const data = await getFavourites().catch(() => null);
      if (!cancelled && data) setOn(data.slugs.includes(bookSlug));
    })();
    return () => {
      cancelled = true;
    };
  }, [status, bookSlug]);

  async function toggle() {
    if (!me) {
      router.push(`/login?next=${encodeURIComponent(`/book/${bookSlug}`)}`);
      return;
    }
    const next = !on;
    /* Optimistic. The heart is the response to the tap; a round trip before it
       fills makes the control feel like it did not register. */
    setOn(next);
    setBusy(true);
    try {
      if (next) await addFavourite(bookSlug);
      else await removeFavourite(bookSlug);
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  }

  const filled = on === true;

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={me ? filled : undefined}
      aria-label={filled ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
      className={cn(
        "grid size-11 cursor-pointer place-items-center rounded-full border transition-colors disabled:opacity-60",
        filled
          ? "border-violet-200 bg-violet-50 text-violet"
          : "border-line bg-card text-muted hover:border-violet-200 hover:text-violet",
        className,
      )}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Heart
          className={cn("size-[18px]", filled && "fill-current")}
          strokeWidth={1.8}
          aria-hidden
        />
      )}
    </button>
  );
}
