import { ShieldAlertIcon } from "lucide-react";
import Link from "next/link";

import type { ShellContext } from "./shell-context";

type Props = { hold: NonNullable<ShellContext["presenceHold"]> };

/**
 * Says on every screen that outgoing money is held by an "is it really you?"
 * check, until when, and where to read it, so a payment that waits is never
 * a mystery. The hold itself is enforced where money moves, not here.
 */
export function PresenceHoldBanner({ hold }: Props) {
  return (
    <div role="status" className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-highlight/40 bg-highlight/10 px-4 py-3 text-sm">
      <ShieldAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
      <p className="min-w-0 flex-1 basis-60 text-pretty">{hold.text}</p>
      {hold.link ? (
        <Link href={hold.link.href} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
          {hold.link.label}
        </Link>
      ) : null}
    </div>
  );
}
