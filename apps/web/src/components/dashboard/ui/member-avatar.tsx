import { Avatar } from "@/components/shared/avatar";
import { InitialsAvatar } from "@/components/shared/initials-avatar";
import { portraitOf } from "@/content/circle-portraits";
import { cn } from "@/lib/utils";

const initialsSizes = { sm: "size-9 text-xs", md: "size-11 text-sm", lg: "size-14 text-base" } as const;

type MemberAvatarProps = {
  /** The portrait key the member's row holds, or `null`. */
  portrait: string | null;
  name: string;
  size?: keyof typeof initialsSizes;
  className?: string;
};

/** A member's portrait, or their initials when the app has none for them. Decorative. */
export function MemberAvatar({ portrait, name, size = "md", className }: MemberAvatarProps) {
  const src = portraitOf(portrait);
  if (src) return <Avatar src={src} size={size} className={className} />;
  return <InitialsAvatar name={name} className={cn(initialsSizes[size], className)} />;
}
