import { HeartHandshakeIcon, PhoneIcon, UsersIcon } from "lucide-react";

import { IconBadge } from "@/components/shared/icon-badge";
import type { Dictionary } from "@/i18n/dictionary";

const ways = [
  { key: "family", icon: UsersIcon },
  { key: "parent", icon: PhoneIcon },
  { key: "caregiver", icon: HeartHandshakeIcon },
] as const;

type SignInWaysProps = { copy: Dictionary["signInPage"]["ways"] };

/** How each kind of person gets in, at a glance. */
export function SignInWays({ copy }: SignInWaysProps) {
  return (
    <ul aria-label={copy.label} className="grid gap-2 sm:grid-cols-3">
      {ways.map((way) => (
        <li key={way.key} className="surface lift min-w-0 rounded-2xl p-4">
          <IconBadge icon={way.icon} className="size-9 border border-gold/40 [&_svg]:size-4" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">{copy.items[way.key].who}</p>
          <p className="mt-0.5 font-semibold">{copy.items[way.key].title}</p>
        </li>
      ))}
    </ul>
  );
}
