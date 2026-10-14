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
    <footer className="border-t pb-[env(safe-area-inset-bottom)]">
      <Container className="py-12 lg:py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Logo href={localizedPath(locale, routes.home)} label={common.brandHome} />
            <p className="mt-3 max-w-sm text-muted-foreground">{footer.tagline}</p>
          </div>
          <FooterLinks
            title={footer.product}
            links={[link("howItWorks", nav.howItWorks), link("safety", nav.safety), link("pricing", nav.pricing)]}
          />
          <FooterLinks
            title={footer.people}
            links={[link("home", footer.forFamilies), link("caregivers", nav.caregivers), link("signIn", nav.signIn)]}
          />
        </div>
        <div className="mt-10 flex flex-wrap items-end justify-between gap-6 border-t pt-6">
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
