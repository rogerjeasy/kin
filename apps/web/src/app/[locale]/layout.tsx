import type { Viewport } from "next";

import { DirectionProvider } from "@/components/layout/direction-provider";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { CONTENT_ID, SkipLink } from "@/components/layout/skip-link";
import { directionOf, locales } from "@/i18n/locales";
import { pageContext } from "@/i18n/page-context";
import { THEME_ATTRIBUTE, themeScript } from "@/theme/theme";

import { fontVariables } from "../fonts";
import "../globals.css";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// Only the seven listed languages exist. Anything else is a 404.
export const dynamicParams = false;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the page paint under a phone's notch, where safe-area padding takes over.
  viewportFit: "cover",
};

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale, dictionary } = await pageContext(params);
  const dir = directionOf(locale);
  // themeScript corrects this attribute before the first paint.
  const themeAttribute = { [THEME_ATTRIBUTE]: "light" };

  return (
    <html lang={locale} dir={dir} className={fontVariables} {...themeAttribute} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <DirectionProvider dir={dir}>
          <SkipLink label={dictionary.common.skipToContent} />
          <SiteHeader locale={locale} common={dictionary.common} />
          <main id={CONTENT_ID}>{children}</main>
          <SiteFooter locale={locale} common={dictionary.common} />
        </DirectionProvider>
      </body>
    </html>
  );
}
