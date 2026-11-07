import { PhoneIcon } from "lucide-react";
import Link from "next/link";

type Props = { href: string; title: string; text: string; label: string };

/** A pointer from the bills screen to the office line, where a demanding caller can be handed to Kin. */
export function OfficeLineLink({ href, title, text, label }: Props) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border bg-card p-5 shadow-xs">
      <PhoneIcon aria-hidden="true" className="size-6 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 basis-60 text-sm">{text}</p>
      <Link href={href} className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold hover:bg-secondary">
        {label}
      </Link>
    </section>
  );
}
