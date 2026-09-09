"use client";

import {
  Bookmark,
  BookmarkCheck,
  ListTree,
  Loader2,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssistantPane } from "@/components/player/AssistantPane";
import { TranscriptPane } from "@/components/player/TranscriptPane";
import { usePlayer } from "@/hooks/usePlayer";
import { ApiError, addBookmark, getEdition, type EditionDetail } from "@/lib/platform";
import { routes } from "@/lib/routes";

/** `1:04:09` / `4:09`. Latin digits; the font renders them Persian. */
function stamp(total: number) {
  const t = Math.max(0, Math.floor(total));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SLEEP_OPTIONS = [5, 15, 30, 60];

export default function PlayerPage() {
  const router = useRouter();
  const params = useParams<{ editionId: string }>();
  const editionId = params.editionId;

  const [data, setData] = useState<EditionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await getEdition(editionId);
        if (!cancelled) setData(detail);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?next=/player/${editionId}`);
          return;
        }
        setError(
          err instanceof ApiError ? err.message : "این نسخه بارگیری نشد.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editionId, router]);

  if (error) {
    return (
      <main className="container-k py-20 text-center">
        <p className="text-[17px] text-muted">{error}</p>
        <Link
          href="/library"
          className="btn mt-6 inline-flex h-11 items-center rounded-lg bg-violet px-5 text-[15px] font-bold text-white"
        >
          بازگشت به کتابخانه
        </Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="container-k py-20">
        <Loader2 className="mx-auto size-6 animate-spin text-muted" aria-label="در حال بارگیری" />
      </main>
    );
  }

  return <Player detail={data} />;
}

function Player({ detail }: { detail: EditionDetail }) {
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

  const { currentTime, duration, isPlaying, seek: seekTo } = player;
  const [marks, setMarks] = useState(detail.bookmarks);
  const [saving, setSaving] = useState(false);

  /* The chapter the head is inside. Found by scan rather than by index maths,
     because chapters are not uniform and the last one runs to the end. */
  const chapter = useMemo(
    () =>
      detail.chapters.find((c) => currentTime >= c.startSec && currentTime < c.endSec) ??
      detail.chapters[detail.chapters.length - 1],
    [detail.chapters, currentTime],
  );

  const atThisSecond = marks.some((m) => m.positionSec === Math.round(currentTime));

  const mark = useCallback(async () => {
    setSaving(true);
    try {
      const res = await addBookmark(detail.editionId, currentTime);
      if (res.created) setMarks((m) => [...m, res.bookmark].sort((a, b) => a.positionSec - b.positionSec));
    } catch {
      /* Non-fatal; the transport keeps running. */
    } finally {
      setSaving(false);
    }
  }, [detail.editionId, currentTime]);

  /* Space to play/pause, arrows to scrub — the shortcuts a listener expects.
     Skipped while typing so the note field keeps its spaces. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if (e.code === "ArrowRight") {
        /* RTL: the leading edge is the right one, so right rewinds. */
        player.skip(-15);
      } else if (e.code === "ArrowLeft") {
        player.skip(30);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  const progress = duration > 0 ? currentTime / duration : 0;
  const barRef = useRef<HTMLDivElement | null>(null);

  const scrubTo = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    /* RTL: distance from the right edge is the elapsed side. */
    const ratio = (rect.right - clientX) / rect.width;
    player.seek(Math.min(Math.max(ratio, 0), 1) * duration);
  };

  return (
    <main className="container-k py-10 sm:py-14">
      <nav className="text-[14px] text-muted">
        <Link href="/library" className="hover:text-ink hover:underline">
          کتابخانه
        </Link>
        <span className="px-2 text-faint">/</span>
        <Link href={routes.book(detail.bookSlug)} className="hover:text-ink hover:underline">
          {detail.title}
        </Link>
      </nav>

      {player.mode === "clock" && (
        <p className="mt-5 rounded-lg bg-violet-50 px-4 py-3 text-[14px] leading-[1.8] text-violet-700">
          فایل صوتی این نسخه هنوز تولید نشده. پخش شبیه‌سازی می‌شود تا همگام‌سازی
          متن، فصل‌ها و ذخیره موقعیت واقعاً کار کنند — ولی صدایی پخش نمی‌شود.
        </p>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Transport ── */}
        <section className="card p-5 sm:p-7">
          <h1 className="text-[22px] font-bold text-ink sm:text-[26px]">{detail.title}</h1>
          <p className="mt-1.5 text-[15px] text-muted">
            {detail.voice?.name ?? "—"}
            {detail.narratorType === "ai" && " · روایت هوش مصنوعی"}
          </p>

          <p className="mt-5 text-[14px] font-medium text-violet">
            {chapter ? chapter.title : "—"}
          </p>

          {/* Scrub bar. A real slider underneath so keyboard and screen-reader
              users get the same control, with the drawn bar on top. */}
          <div className="relative mt-3">
            <div
              ref={barRef}
              onPointerDown={(e) => scrubTo(e.clientX)}
              className="h-2 cursor-pointer overflow-hidden rounded-full bg-paper-2"
            >
              <div
                className="h-full rounded-full bg-violet"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(duration))}
              value={Math.floor(currentTime)}
              onChange={(e) => player.seek(Number(e.target.value))}
              aria-label="موقعیت پخش"
              className="absolute inset-0 h-2 w-full cursor-pointer opacity-0"
            />
          </div>

          <div className="tnum mt-2 flex justify-between text-[13px] text-faint">
            <span>{stamp(currentTime)}</span>
            <span>{stamp(duration)}</span>
          </div>

          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => player.skip(-15)}
              className="grid size-11 place-items-center rounded-full border border-line text-ink transition-colors hover:border-violet-200"
              aria-label="۱۵ ثانیه به عقب"
            >
              <RotateCcw className="size-5" strokeWidth={1.8} aria-hidden />
            </button>

            <button
              type="button"
              onClick={player.toggle}
              className="btn grid size-16 place-items-center rounded-full bg-violet text-white"
              aria-label={isPlaying ? "توقف" : "پخش"}
            >
              {isPlaying ? (
                <Pause className="size-7" fill="currentColor" aria-hidden />
              ) : (
                <Play className="size-7 -translate-x-0.5" fill="currentColor" aria-hidden />
              )}
            </button>

            <button
              type="button"
              onClick={() => player.skip(30)}
              className="grid size-11 place-items-center rounded-full border border-line text-ink transition-colors hover:border-violet-200"
              aria-label="۳۰ ثانیه به جلو"
            >
              <RotateCw className="size-5" strokeWidth={1.8} aria-hidden />
            </button>
          </div>

          {/* Playback state announced once, politely — the spec's aria-live
              requirement. The visual button already carries the same label. */}
          <p aria-live="polite" className="sr-only">
            {isPlaying ? "در حال پخش" : "متوقف"} — {stamp(currentTime)}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-faint">سرعت</span>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => player.setRate(s)}
                aria-pressed={player.rate === s}
                className={`tnum rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  player.rate === s
                    ? "bg-violet text-white"
                    : "bg-paper-2 text-ink-2 hover:bg-violet-50"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[13px] text-faint">
              <Moon className="size-3.5" strokeWidth={1.8} aria-hidden />
              تایمر خواب
            </span>
            {SLEEP_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => player.setSleepInMinutes(m)}
                className="tnum rounded-full bg-paper-2 px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-violet-50"
              >
                {m} دقیقه
              </button>
            ))}
            {player.sleepAtSec !== null && (
              <button
                type="button"
                onClick={() => player.setSleepInMinutes(null)}
                className="tnum rounded-full bg-violet-50 px-3 py-1.5 text-[13px] font-medium text-violet-700"
              >
                توقف در {stamp(player.sleepAtSec)} — لغو
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={mark}
            disabled={saving || atThisSecond}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg border border-line px-4 text-[15px] font-medium text-ink transition-colors hover:border-violet-200 disabled:opacity-60"
          >
            {atThisSecond ? (
              <BookmarkCheck className="size-4" strokeWidth={1.8} aria-hidden />
            ) : (
              <Bookmark className="size-4" strokeWidth={1.8} aria-hidden />
            )}
            {atThisSecond ? "نشانه‌گذاری شده" : "نشانه‌گذاری این لحظه"}
          </button>

          {/* Present even in clock mode so the media path is wired the moment a
              URL exists. `preload="none"` per the spec's LCP note. */}
          <audio
            ref={audioRef}
            src={detail.audioUrl || undefined}
            preload="none"
            className="hidden"
          />
        </section>

        {/* ── Transcript, chapters, marks ── */}
        <aside className="flex flex-col gap-6">
          <AssistantPane
            editionId={detail.editionId}
            chapterIndex={chapter?.index ?? null}
            currentTime={currentTime}
            onSeek={seekTo}
          />

          <TranscriptPane
            cues={detail.transcript}
            currentTime={currentTime}
            onSeek={seekTo}
          />

          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
              <ListTree className="size-4" strokeWidth={1.8} aria-hidden />
              فصل‌ها <span className="tnum text-faint">({detail.chapters.length})</span>
            </h2>
            <ol className="mt-3 flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {detail.chapters.map((c) => {
                const active = chapter?.index === c.index;
                return (
                  <li key={c.index}>
                    <button
                      type="button"
                      onClick={() => player.seek(c.startSec)}
                      aria-current={active ? "true" : undefined}
                      className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-right text-[14px] transition-colors ${
                        active ? "bg-violet-50 text-violet" : "text-ink-2 hover:bg-paper-2"
                      }`}
                    >
                      <span className="tnum shrink-0 text-[12px] text-faint">
                        {stamp(c.startSec)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          {marks.length > 0 && (
            <section className="card p-5">
              <h2 className="text-[15px] font-bold text-ink">
                نشانه‌ها <span className="tnum text-faint">({marks.length})</span>
              </h2>
              <ul className="mt-3 flex flex-col gap-0.5">
                {marks.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => player.seek(m.positionSec)}
                      className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-right text-[14px] text-ink-2 transition-colors hover:bg-paper-2"
                    >
                      <span className="tnum shrink-0 text-[12px] text-violet">
                        {stamp(m.positionSec)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{m.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
