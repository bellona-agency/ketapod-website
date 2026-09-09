"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FALLBACK_AUDIO_ITEM,
  getAudioItem,
  trackEvent,
  type AudioItem,
  type AudioSource,
  type DemoData,
} from "@/lib/api";

export type PlayerStatus = "loading" | "ready" | "unavailable";

type ItemResult = { bookId: string; item: AudioItem; failed: boolean };

const NO_SOURCE_MSG = "در حال حاضر فایل صوتی این آیتم در دسترس نیست.";
const NO_ITEM_MSG = "در حال حاضر پخش صوت در دسترس نیست. بقیه بخش‌ها فعال هستند.";

/**
 * Interactive Demo state machine.
 *
 * Implements the Real Playback contract from the spec: one `<audio>` element is
 * the single source of truth for `isPlaying`, progress and duration; the UI only
 * mirrors it. Nothing here simulates playback.
 *
 * Status, the active source and the effective voice are all *derived* rather
 * than stored, so there is no window where the fetched item and the UI disagree.
 *
 * `demo` is handed in from the server rather than fetched on mount. That was a
 * two-step waterfall — the browser had to hydrate, fetch the demo payload, and
 * only then learn which book to request audio for. Seeded, the audio request
 * can go out on the first render.
 */
export function useDemoPlayer(demo: DemoData) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [result, setResult] = useState<ItemResult | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const [activeBookId, setActiveBookId] = useState<string | null>(demo.sampleBook.id);
  /** What the user picked. The *effective* voice is derived from this below. */
  const [voiceChoice, setVoiceChoice] = useState<string | null>(
    demo.voices.find((v) => v.isDefault)?.id ?? demo.voices[0]?.id ?? null,
  );
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(
    null,
  );
  const [kidsModeEnabled, setKidsModeEnabled] = useState(demo.uiHints.kidsModeDefault);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  /* ── Audio item for the active book ─────────────────────────────────── */

  useEffect(() => {
    if (!activeBookId) return;
    const ac = new AbortController();
    let cancelled = false;

    getAudioItem(activeBookId, { signal: ac.signal })
      .then((item) => {
        if (!cancelled) setResult({ bookId: activeBookId, item, failed: false });
      })
      .catch(() => {
        if (cancelled) return;
        /**
         * Spec: a failed audio item must not blank the section — the UI data
         * stays, the *player* goes unavailable. So the voice/source shape falls
         * back (keeping voice switching browsable) while Play stays disabled,
         * because no fallback source carries a real URL.
         */
        setResult({
          bookId: activeBookId,
          item: { ...FALLBACK_AUDIO_ITEM, bookId: activeBookId },
          failed: true,
        });
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [activeBookId]);

  /** Only the item that matches the current book counts as loaded. */
  const audioItem =
    result && result.bookId === activeBookId ? result.item : null;
  const itemFailed = !!result && result.bookId === activeBookId && result.failed;

  /* ── Voice ⇄ source reconciliation ──────────────────────────────────── */

  /** Only voices that have a matching source are offered (MVP contract). */
  const availableVoices = useMemo(() => {
    if (!demo) return [];
    const ids = new Set(audioItem?.sources.map((s) => s.voiceId) ?? []);
    return demo.voices.map((v) => ({ ...v, available: ids.has(v.id) }));
  }, [demo, audioItem]);

  /**
   * The user's pick wins whenever the new item still carries it; otherwise the
   * default voice, otherwise the first playable source.
   */
  const selectedVoiceId = useMemo(() => {
    if (!audioItem) return voiceChoice;
    const has = (id: string | null) =>
      !!id && audioItem.sources.some((s) => s.voiceId === id);
    if (has(voiceChoice)) return voiceChoice;
    const defaultId = demo?.voices.find((v) => v.isDefault)?.id ?? null;
    return has(defaultId) ? defaultId : (audioItem.sources[0]?.voiceId ?? null);
  }, [audioItem, demo, voiceChoice]);

  const activeSource: AudioSource | null = useMemo(
    () => audioItem?.sources.find((s) => s.voiceId === selectedVoiceId) ?? null,
    [audioItem, selectedVoiceId],
  );

  /* ── Wire the source into the element ───────────────────────────────── */

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const url = activeSource?.audioUrl ?? "";

    if (!url) {
      /* pause() first so the element's own `pause` event syncs isPlaying. */
      el.pause();
      el.removeAttribute("src");
      el.load();
      return;
    }
    if (el.currentSrc === url) return;

    /* Voice swap keeps the position; a new book resets it (handled on select). */
    const resumeAt = el.currentTime;
    const wasPlaying = !el.paused;
    el.src = url;
    el.load();
    el.currentTime = resumeAt;
    if (wasPlaying) void el.play().catch(() => setIsPlaying(false));
  }, [activeSource]);

  /* ── Element → state ────────────────────────────────────────────────── */

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTime = () => setCurrentTime(el.currentTime);
    /* Real duration wins over the API's durationSeconds once it's known. */
    const onMeta = () => setDuration(el.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onError = () => {
      setIsPlaying(false);
      setPlaybackError("پخش این فایل صوتی ممکن نشد. لطفاً صدای دیگری را امتحان کن.");
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, []);

  /* ── Derived player status ──────────────────────────────────────────── */

  const hasPlayableSource = !!activeSource?.audioUrl;

  const status: PlayerStatus = !activeBookId || !audioItem
    ? "loading"
    : hasPlayableSource && !playbackError
      ? "ready"
      : "unavailable";

  const error =
    playbackError ??
    (status === "unavailable" ? (itemFailed ? NO_ITEM_MSG : NO_SOURCE_MSG) : null);

  const canPlay = status === "ready";

  /* ── Actions ────────────────────────────────────────────────────────── */

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !canPlay) return;
    if (el.paused) {
      trackEvent("demo_play_clicked", "demo", "play_button", {
        bookId: activeBookId,
        voiceId: selectedVoiceId,
      });
      void el.play().catch(() => {
        setIsPlaying(false);
        setPlaybackError("پخش شروع نشد. دوباره تلاش کن.");
      });
    } else {
      trackEvent("demo_pause_clicked", "demo", "play_button", { bookId: activeBookId });
      el.pause();
    }
  }, [canPlay, activeBookId, selectedVoiceId]);

  const seek = useCallback(
    (ratio: number) => {
      const el = audioRef.current;
      if (!el || !canPlay || !Number.isFinite(el.duration)) return;
      el.currentTime = Math.min(Math.max(ratio, 0), 1) * el.duration;
      setCurrentTime(el.currentTime);
    },
    [canPlay],
  );

  const selectVoice = useCallback(
    (voiceId: string) => {
      const source = audioItem?.sources.find((s) => s.voiceId === voiceId);
      if (!source) return; // no source ⇒ voice never becomes active
      trackEvent("demo_voice_changed", "demo", "voice_selector", {
        previousVoiceId: selectedVoiceId,
        newVoiceId: voiceId,
        bookId: activeBookId,
      });
      setPlaybackError(null);
      setVoiceChoice(voiceId);
    },
    [audioItem, selectedVoiceId, activeBookId],
  );

  const selectRecommendation = useCallback(
    (recommendationId: string, bookId: string, tag: string, position: number) => {
      trackEvent("demo_recommendation_selected", "demo", "recommendation_card", {
        selectedRecommendationId: recommendationId,
        tag,
        position,
      });
      audioRef.current?.pause();
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setPlaybackError(null);
      setSelectedRecommendationId(recommendationId);
      setActiveBookId(bookId); // triggers the audio-item fetch
    },
    [],
  );

  const toggleKidsMode = useCallback(() => {
    setKidsModeEnabled((prev) => {
      trackEvent("demo_kids_mode_toggled", "demo", "kids_mode_toggle", {
        enabled: !prev,
        bookId: activeBookId,
        selectedVoiceId,
      });
      return !prev;
    });
  }, [activeBookId, selectedVoiceId]);

  /* ── Derived view data ──────────────────────────────────────────────── */

  const activeRecommendation =
    demo?.recommendations.find((r) => r.id === selectedRecommendationId) ?? null;

  const nowPlayingTitle =
    activeRecommendation?.title ?? audioItem?.title ?? demo?.sampleBook.title ?? "";

  const nowPlayingCover =
    activeRecommendation?.coverUrl || audioItem?.coverUrl || demo?.sampleBook.coverUrl || "";

  /**
   * Before real metadata arrives the API's duration stands in, and progress uses
   * the seeded percentage — after that, only the element's clock counts.
   */
  const effectiveDuration =
    duration || audioItem?.durationSeconds || demo?.sampleBook.durationSeconds || 0;

  const progress =
    duration > 0
      ? currentTime / duration
      : (demo?.sampleBook.currentProgressPercent ?? 0) / 100;

  /** Kids mode floats kid-friendly items to the top of the list. */
  const recommendations = useMemo(() => {
    const list = demo?.recommendations ?? [];
    if (!kidsModeEnabled) return list;
    return [...list].sort((a, b) => Number(b.type === "kids") - Number(a.type === "kids"));
  }, [demo, kidsModeEnabled]);

  const recommendedVoiceId =
    audioItem?.sources.find((s) => s.isKidsRecommended)?.voiceId ?? null;

  return {
    audioRef,
    demo,
    audioItem,
    status,
    error,
    canPlay,
    isPlaying,
    currentTime,
    duration: effectiveDuration,
    progress,
    availableVoices,
    activeSource,
    selectedVoiceId,
    selectedRecommendationId,
    recommendations,
    recommendedVoiceId,
    kidsModeEnabled,
    nowPlayingTitle,
    nowPlayingCover,
    toggle,
    seek,
    selectVoice,
    selectRecommendation,
    toggleKidsMode,
  };
}
