import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

type ButtonLinkProps = {
  href: string;
  variant?: "default" | "inverse";
  size?: "default" | "sm";
  className?: string;
  children: ReactNode;
};

/** A link that looks like the main button. */
export function ButtonLink({ href, variant, size, className, children }: ButtonLinkProps) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href={href}>{children}</Link>
    </Button>
  );
}
