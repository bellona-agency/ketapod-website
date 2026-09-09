import {
  Baby,
  BookOpen,
  Brain,
  Clock,
  Globe,
  GraduationCap,
  Languages,
  LayoutGrid,
  Library,
  MessageCircle,
  Mic,
  PlayCircle,
  Pointer,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Volume1,
  Wand2,
  type LucideIcon,
} from "lucide-react";

/**
 * Maps the icon keys used by the content spec onto the Lucide set, so content
 * files stay free of component imports and the icon language stays consistent
 * (one set, one 24×24 viewBox, one stroke weight).
 */
const REGISTRY: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  "message-circle": MessageCircle,
  baby: Baby,
  globe: Globe,
  clock: Clock,
  "volume-1": Volume1,
  sliders: SlidersHorizontal,
  pointer: Pointer,
  "book-open": BookOpen,
  languages: Languages,
  brain: Brain,
  mic: Mic,
  shield: Shield,
  "play-circle": PlayCircle,
  library: Library,
  "user-round": UserRound,
  wand: Wand2,
  layout: LayoutGrid,
  "shield-check": ShieldCheck,
  "graduation-cap": GraduationCap,
};

export function Icon({
  name,
  className = "size-5",
  strokeWidth = 1.6,
}: {
  name: string;
  className?: string;
  strokeWidth?: number;
}) {
  const Cmp = REGISTRY[name] ?? Sparkles;
  return <Cmp className={className} strokeWidth={strokeWidth} aria-hidden />;
}
