"use client";

import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExitLock } from "@/components/kids/ExitLock";
import { CoverArt } from "@/components/primitives/CoverArt";
import { coverIndex } from "@/lib/catalog";
import { usePlayer } from "@/hooks/usePlayer";
import {
  ApiError,
  type EditionDetail,
  getEdition,
  reportListening,
} from "@/lib/platform";

/**
 * The child's player.
 *
 * Same transport as the adult one — one engine, not a second implementation —
 * but the surface is stripped to what the spec's kids rows allow: a very large
 * play button, one rewind, no speed control (the row caps the range and drops
 * the high speeds), no transcript pane, no bookmarks, no notes.
 *
 * The two things it adds are both policy:
 *
 *   * It reports elapsed seconds so the daily cap has something to count, and
 *     stops when the server says the budget is gone.
 *   * It carries the bedtime timer chosen on the shelf, because the spec wants
 *     قصه شب reachable from the first screen rather than from inside here.
 */
export default function KidsPlayerPage() {
  const router = useRouter();
  const { childId, editionId } = useParams<{ childId: string; editionId: string }>();
  const search = useSearchParams();

  const [detail, setDetail] = useState<EditionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getEdition(editionId);
        if (!cancelled) setDetail(d);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?next=/kids/${childId}`);
          return;
        }
        setError("این قصه باز نشد.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editionId, childId, router]);

  if (error) {
    return <main className="grid min-h-dvh place-items-center text-muted">{error}</main>;
  }
  if (!detail) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <Loader2 className="size-8 animate-spin text-violet" aria-label="بارگیری" />
      </main>
    );
  }

  return (
    <KidsPlayer
      detail={detail}
      childId={childId}
      sleepMinutes={Number(search.get("sleep")) || null}
    />
  );
}

function KidsPlayer({
  detail,
  childId,
  sleepMinutes,
}: {
  detail: EditionDetail;
  childId: string;
  sleepMinutes: number | null;
}) {
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const player = usePlayer({
    audioRef,
    editionId: detail.editionId,
    durationSec: detail.durationSec,
    audioUrl: detail.audioUrl,
    initialPositionSec: detail.positionSec,
    title: detail.title,
    voiceName: detail.voice?.name,
  });

  const { isPlaying, currentTime, duration, setSleepInMinutes } = player;
  const [outOfTime, setOutOfTime] = useState(false);

  /* Apply the bedtime chosen on the shelf, once. */
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current || !sleepMinutes) return;
    appliedRef.current = true;
    setSleepInMinutes(sleepMinutes);
  }, [sleepMinutes, setSleepInMinutes]);

  /* ── Screen time ────────────────────────────────────────────────────────
     Elapsed seconds are banked on an interval while playing, and the server
     answers with what is left. The spec puts enforcement on the device so it
     survives being offline — so the stop below is local, and the number it
     trusts is the server's. */

  const bankedAtRef = useRef(currentTime);
  const report = useCallback(async () => {
    const elapsed = Math.round(currentTime - bankedAtRef.current);
    if (elapsed <= 0) return;
    bankedAtRef.current = currentTime;
    try {
      const { screenTime } = await reportListening(childId, detail.editionId, elapsed);
      if (screenTime.exhausted) setOutOfTime(true);
    } catch {
      /* Offline: keep playing. The seconds accumulate and go up on reconnect,
         which is the behaviour the spec's offline note asks for. */
    }
  }, [childId, detail.editionId, currentTime]);

  useEffect(() => {
    if (!isPlaying) return;
    const t = setInterval(() => void report(), 15_000);
    return () => {
      clearInterval(t);
      void report();
    };
  }, [isPlaying, report]);

  useEffect(() => {
    if (outOfTime && isPlaying) player.pause();
  }, [outOfTime, isPlaying, player]);

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <main className="min-h-dvh bg-[radial-gradient(120%_80%_at_50%_0%,#EEF0FF_0%,#F7F8FC_60%)]">
      <div className="container-k flex min-h-dvh flex-col pb-10 pt-6">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => router.push(`/kids/${childId}`)}
            className="rounded-full bg-white/70 px-4 py-2 text-[15px] font-medium text-ink-2"
          >
            قفسه
          </button>
          <ExitLock className="ms-auto" />
        </div>

        <div className="mx-auto mt-6 w-full max-w-xs">
          <CoverArt alt={detail.title} index={coverIndex(detail.bookSlug)} className="aspect-[3/4]" rounded="rounded-3xl" />
        </div>

        <h1 className="mt-6 text-center text-[26px] font-bold text-ink sm:text-[32px]">
          {detail.title}
        </h1>

        {player.mode === "clock" && (
          <p className="mx-auto mt-3 max-w-sm rounded-2xl bg-white/70 px-4 py-2.5 text-center text-[14px] leading-[1.7] text-muted">
            هنوز صدای این قصه ساخته نشده — دکمه‌ها کار می‌کنند ولی صدایی نمی‌آید.
          </p>
        )}

        {outOfTime && (
          <p className="mx-auto mt-4 max-w-sm rounded-2xl bg-amber-100 px-5 py-4 text-center text-[17px] font-medium text-amber-800">
            وقت قصه‌ی امروز تمام شد. فردا دوباره می‌شنویم!
          </p>
        )}

        <div className="mt-8 flex items-center justify-center gap-6">
          <button
            type="button"
            onClick={() => player.skip(-15)}
            aria-label="کمی به عقب"
            className="grid size-14 place-items-center rounded-full bg-white text-ink-2 shadow-e1"
          >
            <RotateCcw className="size-6" strokeWidth={2} aria-hidden />
          </button>

          {/* Deliberately huge — the spec asks for touch targets bigger than the
              adult app's, and this is the only control that matters here. */}
          <button
            type="button"
            onClick={player.toggle}
            disabled={outOfTime}
            aria-label={isPlaying ? "توقف" : "پخش"}
            className="btn grid size-28 place-items-center rounded-full bg-violet text-white shadow-e3 disabled:opacity-50"
          >
            {isPlaying ? (
              <Pause className="size-14" fill="currentColor" aria-hidden />
            ) : (
              <Play className="size-14 translate-x-1" fill="currentColor" aria-hidden />
            )}
          </button>

          <span className="size-14" aria-hidden />
        </div>

        {/* Progress with no timestamps: a child who cannot yet read the clock
            gets a filling bar, which is the whole of what they need. */}
        <div className="mx-auto mt-8 h-3 w-full max-w-sm overflow-hidden rounded-full bg-white">
          <div
            className="h-full rounded-full bg-violet transition-[width] duration-500"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <p aria-live="polite" className="sr-only">
          {isPlaying ? "در حال پخش" : "متوقف"}
        </p>

        {player.sleepAtSec !== null && (
          <p className="mt-6 text-center text-[15px] text-muted">
            بعد از قصه خاموش می‌شود 🌙
          </p>
        )}

        <audio ref={audioRef} src={detail.audioUrl || undefined} preload="none" className="hidden" />
      </div>
    </main>
  );
}
