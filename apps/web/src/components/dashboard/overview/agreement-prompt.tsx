import { ArrowRightIcon, ScrollTextIcon } from "lucide-react";
import Link from "next/link";

/** A version of the family agreement waits for the viewer's acceptance. */
export function AgreementPrompt({ href, text, label }: { href: string; text: string; label: string }) {
  return (
    <Link href={href} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-s-4 border-s-highlight bg-card px-5 py-4 transition-colors hover:bg-muted/60">
      <ScrollTextIcon aria-hidden="true" className="size-5 shrink-0 text-highlight" />
      <span className="min-w-0 flex-1 font-semibold text-pretty">{text}</span>
      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        {label}
        <ArrowRightIcon aria-hidden="true" className="size-4 rtl:-scale-x-100" />
      </span>
    </Link>
  );
}
