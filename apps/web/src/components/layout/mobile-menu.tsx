"use client";

import { ArrowRightIcon, MenuIcon, XIcon } from "lucide-react";
import Link from "next/link";

import { DemoButton } from "@/components/shared/demo-button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { mainNav, routes } from "@/content/site-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { ThemeSelect } from "@/theme/theme-select";

import { LanguageList } from "./language-list";

type MobileMenuProps = {
  locale: Locale;
  common: Dictionary["common"];
  className?: string;
};

/** The header's links, language and theme, in a panel for narrow screens. */
export function MobileMenu({ locale, common, className }: MobileMenuProps) {
  const { nav } = common;
  const links = [...mainNav, "signIn"] as const;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className={className} aria-label={nav.menuOpen}>
          <MenuIcon />
        </Button>
      </SheetTrigger>
      <SheetContent showCloseButton={false} aria-describedby={undefined} className="w-full gap-0 overflow-y-auto p-5 pt-[calc(1.25rem+env(safe-area-inset-top))] sm:max-w-sm">
        <div className="flex items-center justify-between">
          <SheetTitle className="text-sm font-medium text-muted-foreground uppercase ltr:tracking-widest">
            {nav.menuTitle}
          </SheetTitle>
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={nav.menuClose}>
              <XIcon />
            </Button>
          </SheetClose>
        </div>
        <nav aria-label={nav.label} className="enter-stagger mt-4">
          {links.map((key) => (
            <SheetClose key={key} asChild>
              <Link href={localizedPath(locale, routes[key])} className="group flex min-h-14 items-center justify-between gap-3 border-b font-serif text-2xl">
                {nav[key]}
                <ArrowRightIcon aria-hidden="true" className="size-5 shrink-0 text-highlight transition-transform duration-300 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" />
              </Link>
            </SheetClose>
          ))}
        </nav>
        <SheetClose asChild>
          <Button asChild className="mt-6">
            <Link href={localizedPath(locale, routes.start)}>{nav.startLong}</Link>
          </Button>
        </SheetClose>
        <DemoButton locale={locale} label={nav.demo} className="mt-3" />
        <div className="mt-8 flex flex-col items-start gap-4">
          <LanguageList locale={locale} label={common.language.label} />
          <ThemeSelect labels={common.theme} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
