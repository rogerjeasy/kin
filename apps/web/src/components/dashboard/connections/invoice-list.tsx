import { FileWarningIcon, ReceiptTextIcon } from "lucide-react";
import Link from "next/link";

import { Tag } from "@/components/shared/tag";
import type { InvoiceView, RefusedInvoiceView } from "@/content/open-kin/invoice-views";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type Props = {
  invoices: readonly InvoiceView[];
  refused: readonly RefusedInvoiceView[];
  copy: Dictionary["openKin"]["agency"];
  sampleLabel: string;
  billsHref: string;
};

/** The invoices agencies sent through their keys: each one is a bill on the Bills screen, and nothing is paid from here. */
export function InvoiceList({ invoices, refused, copy, sampleLabel, billsHref }: Props) {
  if (invoices.length === 0 && refused.length === 0) return <p className="text-sm text-muted-foreground">{copy.noInvoices}</p>;
  return (
    <ul className="grid min-w-0 gap-3">
      {invoices.map((invoice) => (
        <li key={invoice.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border bg-background/70 p-3">
          <ReceiptTextIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 basis-48">
            <span className="block font-medium wrap-anywhere">{fill(copy.invoice, { agency: invoice.agency, number: invoice.number, amount: invoice.total })}</span>
            <span className="block text-sm text-muted-foreground">{fill(copy.invoiceLines, { count: String(invoice.lines.length), received: invoice.received })}</span>
          </p>
          {invoice.seeded ? <Tag>{sampleLabel}</Tag> : null}
          <Link href={billsHref} className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">
            {copy.billsLink}
          </Link>
        </li>
      ))}
      {refused.map((invoice) => (
        <li key={invoice.id} className="flex min-w-0 items-start gap-3 rounded-2xl border border-dashed p-3 text-sm">
          <FileWarningIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <p className="min-w-0">
            <span className="font-medium">{invoice.agency}</span> · <time>{invoice.received}</time>
            <span className="block text-muted-foreground">{copy.invoiceRefusals[invoice.refusal]}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
