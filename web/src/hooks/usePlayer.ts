"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { putPosition } from "@/lib/platform";

/**
 * The player's transport.
 *
 * There is no audio yet. The spec's media pipeline ends with HLS for streaming
 * and a single m4a for download, and neither has been produced, so every
 * edition's `audioUrl` is empty. That leaves two honest options: refuse to
 * build the player until files exist, or build it against an interface with two
 * implementations and be explicit about which one is running.
 *
 *   `media` — a real `<audio>` element. Used the moment `audioUrl` is non-empty.
 *   `clock` — a rAF-driven timeline. Advances real seconds at the real rate so
 *             transcript sync, chapter jumps, the sleep timer and position
 *             writes are all genuinely exercised; it simply makes no sound.
 *
 * Nothing above this hook knows the difference, which is the point: when the
 * pipeline lands, `audioUrl` fills in and the same UI plays it. The screen says
 * which mode it is in, because a silent player that looked real would be a lie
 * told to whoever demos this next.
 *
 * `hls.js` is deliberately not a dependency yet. The spec names it and it is the
 * right choice, but adding a streaming library for a stream that does not exist
 * is weight with no behaviour. The effect that subscribes to the element is the
 * one place it will be attached.
 *
 * The `<audio>` ref is owned by the caller and passed in, rather than the hook
 * handing back a callback ref. Returning a function that writes `ref.current`
 * marks the whole returned object as ref-bearing, and then even reading
 * `player.mode` — a string — is reported as touching a ref during render.
 */

export type PlayerMode = "media" | "clock";

const SYNC_INTERVAL_MS = 10_000;

export interface PlayerOptions {
  /** Owned by the component, so this hook never writes a ref it handed out. */
  audioRef: RefObject<HTMLAudioElement | null>;
  editionId: string;
  durationSec: number;
  audioUrl: string;
  /** Where the listener left off, from the server. */
  initialPositionSec: number;
  title: string;
  voiceName?: string;
}

export function usePlayer({
  audioRef,
  editionId,
  durationSec,
  audioUrl,
  initialPositionSec,
  title,
  voiceName,
}: PlayerOptions) {
  const mode: PlayerMode = audioUrl ? "media" : "clock";

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialPositionSec);
  const [rate, setRateState] = useState(1);
  const [sleepAtSec, setSleepAtSec] = useState<number | null>(null);

  /* Read by the rAF loop and the sync timer, which must not re-subscribe every
     time the head moves — a ref keeps them stable while staying current.
     Written in an effect rather than during render: a render can be thrown away
     or replayed, and a ref mutated on the way through would then describe a
     frame that never reached the screen. */
  const timeRef = useRef(currentTime);
  const rateRef = useRef(rate);
  const playingRef = useRef(isPlaying);
  const sleepRef = useRef<number | null>(null);

  useEffect(() => {
    timeRef.current = currentTime;
  }, [currentTime]);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    sleepRef.current = sleepAtSec;
  }, [sleepAtSec]);

  /* ── Position sync ──────────────────────────────────────────────────────
     The spec: debounced every ten seconds and on pause. Both go through here,
     and failures are swallowed — a dropped position write must never surface
     as an error over the audio; the next tick carries the same information. */

  const lastSentRef = useRef(initialPositionSec);
  const flush = useCallback(async () => {
    const at = Math.round(timeRef.current);
    if (at === Math.round(lastSentRef.current)) return;
    lastSentRef.current = at;
    try {
      await putPosition(editionId, at);
    } catch {
      /* Offline or 401. The listener is mid-book; do not interrupt them. */
    }
  }, [editionId]);

  useEffect(() => {
    if (!isPlaying) return;
    const t = setInterval(() => void flush(), SYNC_INTERVAL_MS);
    return () => clearInterval(t);
  }, [isPlaying, flush]);

  /* On pause, and on leaving the page mid-listen. */
  useEffect(() => {
    if (isPlaying) return;
    void flush();
  }, [isPlaying, flush]);

  useEffect(() => {
    const onHide = () => void flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      void flush();
    };
  }, [flush]);

  /* ── Transport ──────────────────────────────────────────────────────── */

  const seek = useCallback(
    (sec: number) => {
      const at = Math.min(Math.max(sec, 0), durationSec);
      setCurrentTime(at);
      timeRef.current = at;
      const el = audioRef.current;
      if (el && audioUrl) el.currentTime = at;
    },
    [durationSec, audioUrl, audioRef],
  );

  const play = useCallback(() => {
    /* Restarting from the end rather than refusing to play: pressing play on a
       finished book should replay it, not do nothing. */
    if (timeRef.current >= durationSec - 0.25) seek(0);
    setIsPlaying(true);
    if (audioUrl) void audioRef.current?.play().catch(() => setIsPlaying(false));
  }, [audioUrl, durationSec, seek, audioRef]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (audioUrl) audioRef.current?.pause();
  }, [audioUrl, audioRef]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [play, pause]);

  const setRate = useCallback(
    (r: number) => {
      setRateState(r);
      const el = audioRef.current;
      if (el) el.playbackRate = r;
    },
    [audioRef],
  );

  const skip = useCallback((delta: number) => seek(timeRef.current + delta), [seek]);

  /* ── Clock engine ───────────────────────────────────────────────────────
     Real elapsed time scaled by the playback rate, so 1.5× genuinely covers
     the book half again as fast and the transcript keeps up with it. Driven by
     rAF rather than setInterval so it pauses with the tab instead of leaping
     forward when the tab is restored. */

  useEffect(() => {
    if (mode !== "clock" || !isPlaying) return;
    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = ((now - last) / 1000) * rateRef.current;
      last = now;
      const next = timeRef.current + delta;

      /* Both stop conditions are handled here rather than in a watching effect.
         Inside a rAF callback this is an ordinary event-driven update; from an
         effect body the same two lines are a cascading render, and the sleep
         timer would also overshoot by however long the effect took to run. */
      if (sleepRef.current !== null && next >= sleepRef.current) {
        timeRef.current = sleepRef.current;
        setCurrentTime(sleepRef.current);
        setSleepAtSec(null);
        setIsPlaying(false);
        return;
      }
      if (next >= durationSec) {
        timeRef.current = durationSec;
        setCurrentTime(durationSec);
        setIsPlaying(false);
        return;
      }

      timeRef.current = next;
      setCurrentTime(next);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode, isPlaying, durationSec]);

  /* ── Media engine ─────────────────────────────────────────────────────—
     The element is the single source of truth for its own state, so `isPlaying`
     follows its events rather than being set optimistically alongside them —
     otherwise a browser that blocks autoplay leaves the button saying "pause"
     over silence. */

  useEffect(() => {
    const el = audioRef.current;
    if (!el || mode !== "media") return;
    /* `hls.js` is attached here once a stream exists: Safari plays HLS
       natively, everything else needs the library. */

    const onTime = () => {
      timeRef.current = el.currentTime;
      setCurrentTime(el.currentTime);
      /* Same bedtime rule as the clock engine, so the two are not subtly
         different players wearing one set of controls. */
      if (sleepRef.current !== null && el.currentTime >= sleepRef.current) {
        el.pause();
        setSleepAtSec(null);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [mode, audioRef]);

  /* ── Sleep timer ────────────────────────────────────────────────────────
     The spec calls this one of the most-used features in the kids app (قصه شب).
     It counts down in book-time so that raising the speed brings bedtime
     forward, which is what someone setting "stop in 20 minutes" means.

     The cutoff itself lives in the transport callbacks above — the clock tick
     and the element's `timeupdate` — because that is where time actually moves. */

  const setSleepInMinutes = useCallback(
    (minutes: number | null) =>
      setSleepAtSec(minutes === null ? null : timeRef.current + minutes * 60),
    [],
  );

  /* ── MediaSession ─────────────────────────────────────────────────────—
     What puts the title and the transport controls on the Android notification
     shade and the macOS Now Playing panel. Guarded because it is unsupported on
     some browsers and throws rather than no-ops on others. */

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: voiceName ?? "کتاپاد",
        album: "کتاپاد",
      });
      navigator.mediaSession.setActionHandler("play", () => play());
      navigator.mediaSession.setActionHandler("pause", () => pause());
      navigator.mediaSession.setActionHandler("seekbackward", () => skip(-15));
      navigator.mediaSession.setActionHandler("seekforward", () => skip(30));
    } catch {
      /* Unsupported action; the on-screen controls still work. */
    }
  }, [title, voiceName, play, pause, skip]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  return {
    mode,
    isPlaying,
    currentTime,
    duration: durationSec,
    rate,
    sleepAtSec,
    play,
    pause,
    toggle,
    seek,
    skip,
    setRate,
    setSleepInMinutes,
    flush,
  };
}
