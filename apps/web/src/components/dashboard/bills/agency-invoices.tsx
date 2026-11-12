import type { CircleSnapshot } from "@kin/db";

import { Panel } from "@/components/dashboard/ui/panel";
import type { InvoiceView } from "@/content/open-kin/invoice-views";
import type { Dictionary } from "@/i18n/dictionary";
import type { Formatters } from "@/lib/format";

import { AgencyInvoiceCard } from "./agency-invoice-card";

type Props = {
  invoices: readonly InvoiceView[];
  circle: CircleSnapshot;
  format: Formatters;
  /** Whether the viewer may review and decline: the members who share the cost. */
  mayReview: boolean;
  approvalsHref: string;
  copy: Dictionary["dashboard"]["bills"]["invoices"];
  billCopy: Dictionary["dashboard"]["letters"]["bills"];
  sampleLabel: string;
};

/** The invoices home-care agencies sent through their signed keys, each waiting for a person, never paid by itself. */
export function AgencyInvoices({ invoices, copy, ...card }: Props) {
  return (
    <Panel title={copy.title} description={copy.lede}>
      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="grid min-w-0 gap-4">
          {invoices.map((invoice) => (
            <AgencyInvoiceCard key={invoice.id} invoice={invoice} copy={copy} {...card} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
