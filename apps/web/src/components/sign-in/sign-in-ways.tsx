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
    <ul aria-label={copy.label} className="grid divide-y rounded-2xl border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {ways.map((way) => (
        <li key={way.key} className="min-w-0 p-5">
          <IconBadge icon={way.icon} />
          <p className="mt-4 text-sm font-medium text-muted-foreground">{copy.items[way.key].who}</p>
          <p className="mt-1 font-semibold">{copy.items[way.key].title}</p>
        </li>
      ))}
    </ul>
  );
}
