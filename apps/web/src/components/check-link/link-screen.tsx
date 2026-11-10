import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { LanguageMenu } from "@/components/layout/language-menu";
import { CONTENT_ID } from "@/components/layout/skip-link";
import { Heading } from "@/components/shared/heading";
import { routes } from "@/content/site-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { ThemeToggle } from "@/theme/theme-toggle";

type Props = {
  locale: Locale;
  dictionary: Dictionary;
  /** The words above and below the card: the brand line, the title, the one-line lede and the privacy note. */
  copy: { readonly brand: string; readonly title: string; readonly lede: string; readonly privacy: string };
  children: ReactNode;
};

/**
 * The page someone lands on from a text, a printed code or a tag: a screen of
 * its own, with no site header, no navigation and nothing to sign in to. One
 * column, large type, and the same safe-area padding as the rest of the app.
 * The check-in page and the "is this you?" page are both this screen with
 * their own words.
 */
export function LinkScreen({ locale, dictionary, copy, children }: Props) {
  const { common } = dictionary;
  const theme = { "data-theme": "dark" };
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-2 px-5 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 sm:px-8">
        <Logo href={localizedPath(locale, routes.home)} label={common.brandHome} />
        <div className="flex items-center gap-1">
          <LanguageMenu locale={locale} label={common.language.label} display="code" />
          <ThemeToggle labels={common.theme} />
        </div>
      </header>
      <main id={CONTENT_ID} className="mx-auto w-full min-w-0 max-w-xl flex-1 space-y-4 px-3 pt-3 pb-[calc(2.5rem+env(safe-area-inset-bottom))] sm:px-8 sm:pt-6">
        {/* The words on a small ink panel, lit like the homepage; the tokens inside switch to the dark theme. */}
        <div {...theme} className="aurora relative min-w-0 space-y-3 overflow-clip rounded-[1.75rem] px-6 py-8 text-foreground shadow-xl sm:px-8 sm:py-10">
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-[12%] top-0 h-px bg-linear-to-r from-transparent via-gold/70 to-transparent" />
          <p className="text-base font-medium text-muted-foreground text-pretty">{copy.brand}</p>
          <Heading as="h1" size="title">{copy.title}</Heading>
          <p className="text-lede text-muted-foreground text-pretty">{copy.lede}</p>
        </div>
        <div className="enter surface min-w-0 rounded-3xl p-5 shadow-lg sm:p-7">{children}</div>
        <p className="px-3 pt-2 text-sm text-muted-foreground text-pretty">{copy.privacy}</p>
      </main>
    </div>
  );
}
