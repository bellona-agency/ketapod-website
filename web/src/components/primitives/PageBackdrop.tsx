/**
 * The page's ambient ground.
 *
 * A flat fill behind twelve sections reads as unfinished, so the paper gets a
 * slow vertical temperature shift, a handful of very wide colour washes, and a
 * layer of grain over the whole thing. It is one fixed layer rather than
 * per-section decoration, which means the colour moves *through* the page as a
 * continuous field — sections inherit an atmosphere rather than each carrying
 * their own blob.
 *
 * It used to drift with the scroll, which cost a `useScroll`, a spring and four
 * transformed full-viewport gradient layers running from the very first frame —
 * a large part of the stutter as the page came up. The colour field is what
 * actually does the work here; parked, it does the same job for nothing, and
 * this file goes back to being a server component.
 */
export function PageBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ contain: "strict" }}
    >
      {/*
        Base. A slow vertical shift through the logo's own range rather than the
        old warm-cool-warm swing — that swing was the largest warm surface on
        the page and the main reason the paper argued with the blue.
      */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#FAFBFE_0%,#F0F2F9_34%,#EDEFF8_58%,#F3F5FC_80%,#F8F9FE_100%)]" />

      {/* Wide colour washes, one per end of the logo's gradient. Sized well
          beyond the viewport so the edges never resolve into a visible circle. */}
      <div className="absolute -top-[30vh] right-[-25vw] h-[95vh] w-[95vw] rounded-full bg-[radial-gradient(ellipse_closest-side_at_center,rgba(42,56,255,0.24)_0%,rgba(42,56,255,0.10)_38%,transparent_68%)]" />
      <div className="absolute bottom-[-25vh] left-[-30vw] h-[85vh] w-[85vw] rounded-full bg-[radial-gradient(ellipse_closest-side_at_center,rgba(154,162,255,0.30)_0%,rgba(110,120,255,0.10)_40%,transparent_70%)]" />

      {/* Structure: a faint column grid, fading out before it becomes graph paper. */}
      <div className="absolute inset-0 hidden text-line-2/60 lg:block">
        <div className="container-k h-full">
          <div className="rules h-full opacity-70 [mask-image:linear-gradient(180deg,transparent,black_18%,black_82%,transparent)]" />
        </div>
      </div>

      {/*
        Grain over everything, so the washes never band. Straight opacity, not
        `mix-blend-multiply` — the blend mode forced the whole viewport-sized
        layer through a separate compositing pass on every paint.
      */}
      <div className="grain absolute inset-0 opacity-[0.035]" />
    </div>
  );
}
