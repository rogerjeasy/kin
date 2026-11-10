import { Logo } from "@/components/brand/logo";
import { routes, type RouteKey } from "@/content/site-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { ThemeSelect } from "@/theme/theme-select";

import { Container } from "./container";
import { FooterLinks } from "./footer-links";
import { LanguageMenu } from "./language-menu";

type SiteFooterProps = { locale: Locale; common: Dictionary["common"] };

export function SiteFooter({ locale, common }: SiteFooterProps) {
  const { nav, footer } = common;
  const link = (key: RouteKey, label: string) => ({ href: localizedPath(locale, routes[key]), label });

  return (
    <footer className="relative mt-8 pb-[env(safe-area-inset-bottom)]">
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-[8%] top-0 h-px bg-linear-to-r from-transparent via-gold/60 to-transparent" />
      <Container className="py-14 lg:py-20">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Logo href={localizedPath(locale, routes.home)} label={common.brandHome} />
            <p className="mt-5 max-w-sm font-serif text-2xl leading-snug text-balance">{footer.tagline}</p>
          </div>
          <FooterLinks
            title={footer.product}
            links={[link("howItWorks", nav.howItWorks), link("safety", nav.safety), link("pricing", nav.pricing), link("developers", nav.developers)]}
          />
          <FooterLinks
            title={footer.people}
            links={[link("home", footer.forFamilies), link("caregivers", nav.caregivers), link("signIn", nav.signIn)]}
          />
        </div>
        <div className="mt-14 flex flex-wrap items-end justify-between gap-6 border-t pt-8">
          <div className="max-w-2xl min-w-0 flex-1 basis-80 text-sm text-muted-foreground">
            <p>{footer.disclaimer}</p>
            <p className="mt-2">{footer.photos}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LanguageMenu locale={locale} label={common.language.label} display="name" />
            <ThemeSelect labels={common.theme} />
          </div>
        </div>
      </Container>
    </footer>
  );
}
