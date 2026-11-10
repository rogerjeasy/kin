import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { LanguageMenu } from "@/components/layout/language-menu";
import { CONTENT_ID } from "@/components/layout/skip-link";
import { Eyebrow } from "@/components/shared/eyebrow";
import { GlowKnot } from "@/components/shared/glow-knot";
import { Heading } from "@/components/shared/heading";
import { Lede } from "@/components/shared/lede";
import { routes } from "@/content/site-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { ThemeToggle } from "@/theme/theme-toggle";

type AccountScreenProps = {
  locale: Locale;
  common: Dictionary["common"];
  eyebrow: string;
  title: string;
  lede: string;
  /** A short card under the words: what happens next, or who gets in how. */
  aside: ReactNode;
  /** The form. */
  children: ReactNode;
};

/**
 * A screen of its own for signing in or starting a circle, without the site's
 * header and footer. On a wide screen it is two halves: the words on an ink
 * panel lit by the Kin knot, the form on a lit card beside it with the short
 * card under it. On a phone they stack in the same order: words, form, card.
 */
export function AccountScreen({ locale, common, eyebrow, title, lede, aside, children }: AccountScreenProps) {
  const theme = { "data-theme": "dark" };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-2 px-5 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 sm:px-8 lg:px-10">
        <Logo href={localizedPath(locale, routes.home)} label={common.brandHome} />
        <div className="flex items-center gap-1">
          <LanguageMenu locale={locale} label={common.language.label} display="code" />
          <ThemeToggle labels={common.theme} />
        </div>
      </header>
      <main
        id={CONTENT_ID}
        className="grid flex-1 gap-2 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-3 lg:grid-cols-2 lg:grid-rows-[1fr_auto] lg:gap-x-3"
      >
        <section
          {...theme}
          className="aurora relative flex min-w-0 flex-col justify-between gap-10 overflow-clip rounded-[1.75rem] px-5 py-8 text-foreground shadow-xl sm:rounded-[2.25rem] sm:px-10 sm:py-10 lg:row-span-2 lg:px-14 lg:py-14"
        >
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-[12%] top-0 h-px bg-linear-to-r from-transparent via-gold/70 to-transparent" />
          <GlowKnot className="w-20 sm:w-28 lg:w-56 xl:w-64" />
          <div className="enter-stagger min-w-0">
            <Eyebrow>{eyebrow}</Eyebrow>
            <Heading as="h1" size="display" className="mt-5 max-w-xl">
              {title}
            </Heading>
            <Lede className="mt-6">{lede}</Lede>
          </div>
        </section>
        <div className="flex min-w-0 items-center justify-center px-3 py-8 sm:px-6 lg:px-10 lg:pt-14 lg:pb-6">
          <div className="enter surface w-full max-w-md rounded-3xl p-6 shadow-lg sm:p-9">{children}</div>
        </div>
        <div className="flex min-w-0 justify-center px-3 pb-8 sm:px-6 lg:px-10 lg:pb-14">
          <div className="w-full max-w-xl">{aside}</div>
        </div>
      </main>
    </div>
  );
}
