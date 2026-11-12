import { Logo } from "@/components/brand/logo";
import { DemoButton } from "@/components/shared/demo-button";
import { routes } from "@/content/site-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { ThemeToggle } from "@/theme/theme-toggle";

import { Container } from "./container";
import { LanguageMenu } from "./language-menu";
import { MainNav } from "./main-nav";
import { MobileMenu } from "./mobile-menu";
import { NavLink } from "./nav-link";

type SiteHeaderProps = { locale: Locale; common: Dictionary["common"] };

/**
 * Wide screens show everything. Below xl the links move into the menu, and on
 * a phone so do language, theme and the demo button, so nothing is squeezed.
 * The demo is the main button: most visitors want to see Kin before they start.
 */
export function SiteHeader({ locale, common }: SiteHeaderProps) {
  const { nav } = common;

  return (
    <header className="glass sticky top-0 z-40 border-b border-border/60 pt-[env(safe-area-inset-top)]">
      <Container className="flex min-h-(--header-height) items-center gap-2">
        <Logo href={localizedPath(locale, routes.home)} label={common.brandHome} />
        <MainNav locale={locale} labels={nav} className="ms-10 hidden xl:flex" />
        <div className="ms-auto flex items-center gap-1">
          <LanguageMenu locale={locale} label={common.language.label} display="code" className="hidden sm:inline-flex" />
          <ThemeToggle labels={common.theme} className="hidden sm:inline-flex" />
          <NavLink href={localizedPath(locale, routes.signIn)} route={routes.signIn} className="hidden px-3 text-foreground xl:inline-flex">
            {nav.signIn}
          </NavLink>
          <NavLink href={localizedPath(locale, routes.start)} route={routes.start} className="hidden px-3 text-foreground lg:inline-flex">
            {nav.start}
          </NavLink>
          <DemoButton locale={locale} label={nav.demo} size="sm" variant="default" className="hidden sm:inline-flex" />
          <MobileMenu locale={locale} common={common} className="xl:hidden" />
        </div>
      </Container>
    </header>
  );
}
