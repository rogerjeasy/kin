import { HeartPulseIcon } from "lucide-react";
import Link from "next/link";

import type { ShellContext } from "./shell-context";

type Props = { notice: NonNullable<ShellContext["wishesNotice"]> };

/**
 * Says on every screen that someone said the parent is in hospital or a care
 * home, and whether her wishes are in effect, with the way to what changed. The
 * wishes themselves are applied where money moves, not here.
 */
export function WishesBanner({ notice }: Props) {
  return (
    <div role="status" className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-highlight/40 bg-highlight/10 px-4 py-3 text-sm">
      <HeartPulseIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
      <p className="min-w-0 flex-1 basis-60 text-pretty">{notice.text}</p>
      <Link href={notice.link.href} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
        {notice.link.label}
      </Link>
    </div>
  );
}
