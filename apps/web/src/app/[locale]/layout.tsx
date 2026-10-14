import type { Viewport } from "next";

import { DirectionProvider } from "@/components/layout/direction-provider";
import { SkipLink } from "@/components/layout/skip-link";
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

/**
 * What every screen shares: the language, the fonts and the theme. The public
 * pages add the site's header and footer in (site)/layout.tsx. The sign-in and
 * start screens stand alone.
 */
export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale, dictionary } = await pageContext(params);
  const dir = directionOf(locale);
  // themeScript corrects this attribute before the first paint.
  const themeAttribute = { [THEME_ATTRIBUTE]: "light" };
  // Links inside a page scroll smoothly. This tells Next to switch that off
  // while it moves to a new page, so the page opens at its top at once.
  const scrollAttribute = { "data-scroll-behavior": "smooth" };

  return (
    <html lang={locale} dir={dir} className={fontVariables} {...themeAttribute} {...scrollAttribute} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <DirectionProvider dir={dir}>
          <SkipLink label={dictionary.common.skipToContent} />
          {children}
        </DirectionProvider>
      </body>
    </html>
  );
}
