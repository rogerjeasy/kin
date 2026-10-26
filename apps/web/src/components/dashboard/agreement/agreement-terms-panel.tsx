import type { ReactNode } from "react";

import { TermList } from "@/components/dashboard/circle/term-list";
import { Panel } from "@/components/dashboard/ui/panel";
import { ShareBar } from "@/components/shared/share-bar";
import { ShareLegend, type LegendShare } from "@/components/shared/share-legend";
import type { Locale } from "@/i18n/locales";

type Props = {
  locale: Locale;
  title: string;
  description: string;
  sharesTitle: string;
  shares: readonly LegendShare[];
  example: string;
  terms: readonly { label: string; value: string }[];
  /** Who accepted it, below the terms. */
  children?: ReactNode;
};

/** One version's terms: the shares, drawn and named, a month shared out, and every limit. */
export function AgreementTermsPanel({ locale, title, description, sharesTitle, shares, example, terms, children }: Props) {
  return (
    <Panel title={title} description={description}>
      <div className="min-w-0 space-y-6">
        <section className="min-w-0 space-y-3">
          <h3 className="font-semibold">{sharesTitle}</h3>
          <ShareBar label={sharesTitle} shares={shares} />
          <ShareLegend locale={locale} shares={shares} align="start" />
          <p className="text-sm text-muted-foreground wrap-anywhere">{example}</p>
        </section>
        <TermList terms={terms} />
        {children}
      </div>
    </Panel>
  );
}
