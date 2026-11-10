import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type TextLinkProps = { href: string; className?: string; children: ReactNode };

/** An underlined link with a full-height touch target. The line draws across on hover. */
export function TextLink({ href, className, children }: TextLinkProps) {
  return (
    <Link href={href} className={cn("group inline-flex min-h-11 items-center font-medium", className)}>
      <span className="relative pb-0.5">
        {children}
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-current opacity-40" />
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-current transition-transform duration-500 ease-(--ease-out-expo) group-hover:scale-x-100 rtl:origin-right" />
      </span>
    </Link>
  );
}
