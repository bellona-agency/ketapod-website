/**
 * 3D asset slots.
 *
 * Every decorative render on the page is addressed through this map, so
 * swapping art is a one-line change and no component hard-codes a path.
 *
 * The files are sliced out of the transparent asset sheet by
 * `scripts/slice-assets.py`. That sheet ships a real alpha channel, so the
 * cut-outs keep their soft shadows and glows — no matting involved.
 */
export const ASSETS = {
  /** Hero, floating beside the device. Portrait-ish. Display ~150px. */
  heroHeadphones: "/assets/headphones.webp",
  /** Hero, floating disc. Square. Display ~110px. */
  heroWaveformCoin: "/assets/waveform-coin.webp",
  /** Interactive Demo, beside the console on wide screens. Display ~200px. */
  demoMicrophone: "/assets/microphone.webp",
  /** Kids section, main render. Display ~380px. */
  kidsScene: "/assets/kid-scene.webp",
  /** Localization, behind the sample cards. Display ~220px. */
  localizationGlobe: "/assets/globe.webp",
  /** FAQ, one bubble per side of the column pair. Display ~110px. */
  faqBubbleViolet: "/assets/bubble-violet.webp",
  faqBubbleGreen: "/assets/bubble-green.webp",
  /** Lead form, on the violet pitch panel. Display ~200px. */
  leadEnvelope: "/assets/envelope.webp",
  /** Final CTA, beside the headline on the dark panel. Display ~260px. */
  finalCtaHeadphones: "/assets/headphones-play.webp",

  /**
   * Why Us cards. These renders ship with their own soft-square plate, so the
   * card draws no chip behind them — the tile *is* the chip. Keyed by the card
   * id in `content.ts`. Display ~64px.
   */
  "whyUs.smart-recommendation": "/assets/tile-books.webp",
  "whyUs.interactive": "/assets/tile-chat.webp",
  "whyUs.kids": "/assets/tile-kid.webp",
  "whyUs.localization": "/assets/tile-globe.webp",

  /**
   * The کتاب‌یار capability cards on `/ai`. Keyed by the card id in the page's
   * `CAPABILITIES` list. Display ~96px.
   *
   * These came out of a render of the whole section rather than a gallery
   * sheet, so `scripts/extract-assistant-assets.py` cuts them from the card
   * grid instead of from hand-measured boxes. Each one keeps the orbit ring and
   * its satellites — that ring is the motif the section is built on, and it is
   * drawn into the render, not composed underneath it.
   */
  "assistant.context": "/assets/ai-context.webp",
  "assistant.summary": "/assets/ai-summary.webp",
  "assistant.quiz": "/assets/ai-quiz.webp",
  "assistant.search": "/assets/ai-search.webp",
  "assistant.voice": "/assets/ai-voice.webp",
  "assistant.transcript": "/assets/ai-transcript.webp",
} as const;

/**
 * `phone-headphones.webp` is also sliced and kept — the full device composition,
 * an alternative to the coded hero mockup. The other unclaimed slices were
 * deleted rather than left in `public/`, where they were dead weight in every
 * deploy.
 */

/** Empty string ⇒ fall back to the designed placeholder. */
export const asset = (key: keyof typeof ASSETS) => ASSETS[key] || undefined;
