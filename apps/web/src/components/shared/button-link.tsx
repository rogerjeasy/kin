import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

type ButtonLinkProps = {
  href: string;
  variant?: "default" | "inverse" | "outline";
  size?: "default" | "sm";
  className?: string;
  children: ReactNode;
};

/** A link that looks like a button: the main one by default. */
export function ButtonLink({ href, variant, size, className, children }: ButtonLinkProps) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href={href}>{children}</Link>
    </Button>
  );
}
