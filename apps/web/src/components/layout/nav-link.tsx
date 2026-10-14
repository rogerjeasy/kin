"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { pagePath } from "@/i18n/routing";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

type NavLinkProps = {
  /** The link's address, language prefix included. */
  href: string;
  /** The page it leads to, without a language prefix. */
  route: string;
  className?: string;
  children: ReactNode;
};

/** A header link that knows when it points at the current page. */
export function NavLink({ href, route, className, children }: NavLinkProps) {
  const pathname = usePathname();
  // A prerendered page does not know its own address, so the mark is added
  // once the browser has taken over.
  const isCurrent = useHydrated() && pagePath(pathname) === route;

  return (
    <Link
      href={href}
      aria-current={isCurrent ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center whitespace-nowrap text-muted-foreground decoration-highlight decoration-2 underline-offset-8 hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:underline",
        className,
      )}
    >
      {children}
    </Link>
  );
}
