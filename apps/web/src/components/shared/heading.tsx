import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const sizes = {
  display: "text-display",
  title: "text-title",
  subtitle: "text-subtitle",
} as const;

type HeadingProps = {
  as: "h1" | "h2" | "h3";
  size: keyof typeof sizes;
  id?: string;
  className?: string;
  children: ReactNode;
};

/** Serif display type. The tag sets the outline, the size sets the look. */
export function Heading({ as: Tag, size, id, className, children }: HeadingProps) {
  return (
    <Tag id={id} className={cn("font-serif font-normal text-balance ltr:tracking-tight", sizes[size], className)}>
      {children}
    </Tag>
  );
}
