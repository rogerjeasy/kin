import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { LanguageMenu } from "@/components/layout/language-menu";
import { CONTENT_ID } from "@/components/layout/skip-link";
import { Eyebrow } from "@/components/shared/eyebrow";
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
 * header and footer. On a wide screen it is two halves: the words on a tinted
 * side, the form on the other. The tint is one background cut at the middle,
 * so the top bar can run across both. On a phone the halves stack: words,
 * form, then the card.
 */
export function AccountScreen({ locale, common, eyebrow, title, lede, aside, children }: AccountScreenProps) {
  return (
    <div className="flex min-h-dvh flex-col lg:bg-linear-to-r lg:from-muted lg:from-50% lg:to-background lg:to-50% rtl:lg:bg-linear-to-l">
      <header className="flex items-center justify-between gap-2 bg-muted px-5 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 sm:px-8 lg:bg-transparent lg:px-14">
        <Logo href={localizedPath(locale, routes.home)} label={common.brandHome} />
        <div className="flex items-center gap-1">
          <LanguageMenu locale={locale} label={common.language.label} display="code" />
          <ThemeToggle labels={common.theme} />
        </div>
      </header>
      <main id={CONTENT_ID} className="grid flex-1 pb-[env(safe-area-inset-bottom)] lg:grid-cols-2 lg:grid-rows-[1fr_auto]">
        <div className="flex min-w-0 flex-col justify-center bg-muted px-5 pt-6 pb-10 sm:px-8 lg:bg-transparent lg:px-14 lg:py-10">
          <Eyebrow>{eyebrow}</Eyebrow>
          <Heading as="h1" size="display" className="mt-5 max-w-xl">
            {title}
          </Heading>
          <Lede className="mt-6">{lede}</Lede>
        </div>
        <div className="flex min-w-0 items-center justify-center px-5 py-10 sm:px-8 lg:row-span-2 lg:px-14">
          <div className="w-full max-w-md">{children}</div>
        </div>
        <div className="min-w-0 px-5 pb-10 sm:px-8 lg:px-14 lg:pb-12">{aside}</div>
      </main>
    </div>
  );
}
