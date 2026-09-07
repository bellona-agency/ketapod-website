"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@/lib/utils";

export type RevealVariant = "up" | "in" | "inline" | "scale" | "rule";

type Tag =
  | "div"
  | "section"
  | "ul"
  | "ol"
  | "li"
  | "article"
  | "header"
  | "footer"
  | "figure"
  /* `span` is here for reveals that sit inside a flex row of chips, where a
     `div` would be the same box but the wrong element. */
  | "span";

/**
 * One IntersectionObserver, one boolean. The transition itself is the
 * `.kp-reveal` rule in `globals.css`.
 *
 * This is the whole reason most of the page can be server-rendered: the
 * entrance no longer needs an animation library inside the section, only this
 * small island wrapped around it.
 */
function useInViewOnce<T extends HTMLElement>(amount: number) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        io.disconnect();
      },
      /* Clamped: an element taller than the viewport can never reach a high
         ratio, and would then never appear. */
      { threshold: Math.min(amount, 0.5) },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [amount]);

  return [ref, shown] as const;
}

/**
 * Scroll-triggered entrance for a single element.
 *
 * `delay` is for hand-tuned beats between two neighbouring elements, not for
 * faking a stagger — use `RevealGroup` for that.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  v = "up",
  amount = 0.2,
  as = "div",
  style,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  v?: RevealVariant;
  amount?: number;
  as?: Tag;
  style?: CSSProperties;
}) {
  const [ref, shown] = useInViewOnce<HTMLDivElement>(amount);
  const Cmp = as as ElementType;

  return (
    <Cmp
      ref={ref as Ref<HTMLDivElement>}
      className={cn("kp-reveal", className)}
      data-v={v}
      data-shown={shown || undefined}
      style={delay ? ({ ...style, "--kp-rd": `${delay}s` } as CSSProperties) : style}
    >
      {children}
    </Cmp>
  );
}

/**
 * Parent for `RevealItem` children.
 *
 * The group owns the observer; the stagger is handed to each child as a CSS
 * transition-delay, so a twelve-tile grid still costs exactly one observer.
 */
export function RevealGroup({
  children,
  className,
  stagger = 0.07,
  delayChildren = 0,
  amount = 0.2,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delayChildren?: number;
  amount?: number;
  as?: Tag;
}) {
  const [ref, shown] = useInViewOnce<HTMLDivElement>(amount);
  const Cmp = as as ElementType;

  let i = 0;
  const staggered = Children.map(children, (child) => {
    if (!isValidElement<{ style?: CSSProperties }>(child)) return child;
    const delay = delayChildren + stagger * i++;
    return cloneElement(child, {
      style: {
        ...child.props.style,
        "--kp-rd": `${delay.toFixed(3)}s`,
      } as CSSProperties,
    });
  });

  return (
    <Cmp ref={ref as Ref<HTMLDivElement>} className={cn(shown && "kp-shown", className)}>
      {staggered}
    </Cmp>
  );
}

/**
 * A member of a `RevealGroup`. Inert on its own — it waits for the group's
 * `kp-shown` class rather than observing anything itself.
 */
export function RevealItem({
  children,
  className,
  v = "up",
  as = "div",
  style,
}: {
  children: ReactNode;
  className?: string;
  v?: RevealVariant;
  as?: Tag;
  style?: CSSProperties;
}) {
  const Cmp = as as ElementType;
  return (
    <Cmp className={cn("kp-reveal", className)} data-v={v} style={style}>
      {children}
    </Cmp>
  );
}
