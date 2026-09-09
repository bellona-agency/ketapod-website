import { cn } from "@/lib/utils";

/**
 * The child's avatar.
 *
 * Emoji rather than an illustration set: the kids surface needs a face per
 * profile from the first screen, and four more image assets to slice and ship
 * would be weight for something that is a picker, not artwork. The moment real
 * character art exists this is the one component it lands in.
 */
export const AVATAR_ART = {
  fox: "🦊",
  owl: "🦉",
  whale: "🐳",
  robot: "🤖",
} as const;

export type Avatar = keyof typeof AVATAR_ART;

export function AvatarBadge({
  avatar,
  className,
}: {
  avatar: Avatar;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-paper-2 leading-none",
        className,
      )}
    >
      {AVATAR_ART[avatar]}
    </span>
  );
}
