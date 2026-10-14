import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { CONTENT_ID } from "@/components/layout/skip-link";
import { pageContext } from "@/i18n/page-context";

/** The public pages: the site's header above, its footer below. */
export default async function SiteLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale, dictionary } = await pageContext(params);

  return (
    <>
      <SiteHeader locale={locale} common={dictionary.common} />
      <main id={CONTENT_ID}>{children}</main>
      <SiteFooter locale={locale} common={dictionary.common} />
    </>
  );
}
