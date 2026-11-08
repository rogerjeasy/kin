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

type Props = { locale: Locale; dictionary: Dictionary; children: ReactNode };

/**
 * The page a caregiver lands on from a text, a printed code or a tag: a screen
 * of its own, with no site header, no navigation and nothing to sign in to. One
 * column, large type, and the same safe-area padding as the rest of the app.
 */
export function CheckScreen({ locale, dictionary, children }: Props) {
  const { checkLink, common } = dictionary;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-2 px-5 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 sm:px-8">
        <Logo href={localizedPath(locale, routes.home)} label={common.brandHome} />
        <div className="flex items-center gap-1">
          <LanguageMenu locale={locale} label={common.language.label} display="code" />
          <ThemeToggle labels={common.theme} />
        </div>
      </header>
      <main id={CONTENT_ID} className="mx-auto w-full min-w-0 max-w-xl flex-1 space-y-8 px-5 pt-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] sm:px-8">
        <div className="min-w-0 space-y-3">
          <p className="text-base font-medium text-muted-foreground text-pretty">{checkLink.brand}</p>
          <Heading as="h1" size="title">{checkLink.title}</Heading>
          <p className="text-lede text-muted-foreground text-pretty">{checkLink.lede}</p>
        </div>
        {children}
        <p className="text-sm text-muted-foreground text-pretty">{checkLink.privacy}</p>
      </main>
    </div>
  );
}
