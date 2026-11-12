import { PlayIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/locales";
import { startDemo } from "@/server/demo-actions";

type DemoButtonProps = {
  locale: Locale;
  label: string;
  variant?: "default" | "inverse" | "outline" | "ghost";
  size?: "default" | "sm";
  className?: string;
};

/**
 * Opens the demo: an anonymous visitor's own copy of Rose's circle, with no
 * account. A form, not a link, because pressing it creates the visitor.
 */
export function DemoButton({ locale, label, variant = "outline", size = "default", className }: DemoButtonProps) {
  return (
    <form action={startDemo} className="contents">
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" variant={variant} size={size} className={className}>
        <PlayIcon aria-hidden="true" />
        {label}
      </Button>
    </form>
  );
}
