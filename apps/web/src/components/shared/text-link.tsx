import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type TextLinkProps = { href: string; className?: string; children: ReactNode };

/** An underlined link with a full-height touch target. */
export function TextLink({ href, className, children }: TextLinkProps) {
  return (
    <Link href={href} className={cn("inline-flex min-h-11 items-center font-medium", className)}>
      <span className="border-b border-current pb-0.5">{children}</span>
    </Link>
  );
}
