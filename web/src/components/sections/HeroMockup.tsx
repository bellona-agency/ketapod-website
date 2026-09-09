import { Heart, Pause, Repeat, SkipBack, SkipForward, Sparkles } from "lucide-react";
import { CoverArt } from "@/components/primitives/CoverArt";
import { Waveform } from "@/components/primitives/Waveform";

/**
 * Hero product mockup — built in markup rather than pasted as a flat image, so
 * it stays crisp, themable and responsive. Decorative only: the real player
 * with actual audio lives in the Interactive Demo section.
 *
 * Fully static now: the tilt and the entrance are a CSS keyframe, so the
 * largest thing above the fold is plain HTML that paints before any JavaScript
 * has run.
 */
export function HeroMockup() {
  return (
    <div className="kp-mockup-in relative w-[268px] shrink-0 sm:w-[300px]">
      {/* Device */}
      <div className="relative rounded-[42px] bg-ink p-[9px] shadow-e4">
        <div className="relative overflow-hidden rounded-[34px] bg-[#f7f5ff]">
          {/* status bar */}
          <div className="flex items-center justify-between px-5 pt-3.5 pb-1">
            <span className="tnum text-[13px] font-medium text-ink-2">9:41</span>
            <span className="h-[18px] w-[62px] rounded-full bg-ink" />
            <span className="flex items-center gap-[3px]" aria-hidden>
              {[4, 6, 8].map((h) => (
                <span
                  key={h}
                  className="w-[3px] rounded-sm bg-ink-2"
                  style={{ height: h }}
                />
              ))}
              <span className="ms-1 h-[9px] w-[16px] rounded-[3px] border border-ink-2/60 p-[1.5px]">
                <span className="block h-full w-2/3 rounded-[1px] bg-ink-2" />
              </span>
            </span>
          </div>

          <div className="px-5 pb-6 pt-3">
            {/* now-playing header */}
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[13px] font-medium text-muted">در حال پخش</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-[3px] text-[13px] font-semibold text-violet-700">
                <Sparkles className="size-2.5" strokeWidth={2} aria-hidden />
                پیشنهاد هوشمند
              </span>
            </div>

            {/* cover */}
            <CoverArt
              alt="کاور نمونه کتاب صوتی"
              index={0}
              rounded="rounded-[18px]"
              className="aspect-square w-full shadow-e3"
              sizes="300px"
            />

            {/* meta */}
            <div className="mt-4 text-center">
              <p className="text-[18px] font-bold text-ink">انسان در جستجوی معنا</p>
              <p className="mt-0.5 text-[13px] text-muted">ویکتور فرانکل · گوینده: آرام</p>
            </div>

            {/* waveform + progress */}
            <div className="mt-4">
              <Waveform
                bars={26}
                active
                seed={11}
                className="h-9 text-violet/45"
                barClassName="w-[2.5px]"
              />
              <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-violet-100">
                <div className="kp-progress-in h-full w-[42%] rounded-full bg-violet" />
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="tnum text-[13px] text-muted">08:42</span>
                <span className="tnum text-[13px] text-muted">20:40</span>
              </div>
            </div>

            {/* transport */}
            <div className="mt-4 flex items-center justify-center gap-5" aria-hidden>
              <Repeat className="size-4 text-muted" strokeWidth={1.8} />
              <SkipForward className="size-[18px] text-ink-2" strokeWidth={1.8} />
              <span className="grid size-12 place-items-center rounded-full bg-violet text-white shadow-violet">
                <Pause className="size-5 fill-current" strokeWidth={0} />
              </span>
              <SkipBack className="size-[18px] text-ink-2" strokeWidth={1.8} />
              <Heart className="size-4 text-muted" strokeWidth={1.8} />
            </div>

            {/* voice chips */}
            <div className="mt-5 flex items-center justify-center gap-1.5">
              {["آرام", "نمایشی", "کودک"].map((v, i) => (
                <span
                  key={v}
                  className={
                    i === 0
                      ? "rounded-full bg-ink px-2.5 py-1 text-[13px] font-medium text-white"
                      : "rounded-full border border-line-2 bg-white px-2.5 py-1 text-[13px] text-muted"
                  }
                >
                  {v}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Screen glare — one soft diagonal, keeps the device from reading flat */}
      <div
        className="pointer-events-none absolute inset-0 rounded-[42px] bg-gradient-to-bl from-white/35 via-transparent to-transparent"
        aria-hidden
      />
    </div>
  );
}
