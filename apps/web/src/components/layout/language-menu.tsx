"use client";

import { ChevronDownIcon, GlobeIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { localeNames, locales, type Locale } from "@/i18n/locales";
import { switchLocale } from "@/i18n/routing";

type LanguageMenuProps = {
  locale: Locale;
  label: string;
  /** The header shows the short code, the footer the language's full name. */
  display: "code" | "name";
  className?: string;
};

export function LanguageMenu({ locale, label, display, className }: LanguageMenuProps) {
  const pathname = usePathname();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={display === "code" ? "ghost" : "outline"}
          size="sm"
          className={className}
          aria-label={`${label}: ${localeNames[locale]}`}
        >
          <GlobeIcon />
          <span className={display === "code" ? "uppercase" : undefined}>
            {display === "code" ? locale : localeNames[locale]}
          </span>
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-2xl p-1.5 shadow-xl">
        {locales.map((target) => (
          <DropdownMenuItem key={target} asChild>
            <Link
              href={switchLocale(pathname, target)}
              lang={target}
              hrefLang={target}
              aria-current={target === locale ? "true" : undefined}
              className="min-h-11 rounded-xl px-3 text-base aria-[current=true]:font-semibold aria-[current=true]:text-highlight"
            >
              {localeNames[target]}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
