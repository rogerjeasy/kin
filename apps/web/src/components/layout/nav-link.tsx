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
        "relative inline-flex min-h-11 items-center whitespace-nowrap text-muted-foreground transition-colors duration-300 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-2 after:h-0.5 after:origin-center after:scale-x-0 after:rounded-full after:bg-gold after:shadow-[0_0_10px_1px_rgb(var(--glow-gold)/0.6)] after:transition-transform after:duration-500 after:ease-(--ease-out-expo) hover:text-foreground hover:after:scale-x-50 aria-[current=page]:text-foreground aria-[current=page]:after:scale-x-100",
        className,
      )}
    >
      {children}
    </Link>
  );
}
