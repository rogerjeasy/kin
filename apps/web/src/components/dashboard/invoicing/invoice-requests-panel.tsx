import type { CircleSnapshot } from "@kin/db";
import { TOP_UP_LIMITS } from "@kin/domain";

import { Panel } from "@/components/dashboard/ui/panel";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { may } from "@/server/dashboard-context";
import { topUpServices } from "@/server/paypal";

import { InvoiceStatus } from "./invoice-status";
import { InvoiceTopUpForm } from "./invoice-top-up-form";
import { invoiceViewer } from "./invoice-viewer";

type Props = { locale: Locale; dictionary: Dictionary; circle: CircleSnapshot };

/**
 * Every request for money by PayPal invoice, newest first, open to everyone
 * who sees the circle's money, and, for an organizer where this deployment
 * has PayPal, the form that asks a member for a top-up.
 */
export function InvoiceRequestsPanel({ locale, dictionary, circle }: Props) {
  if (!may(circle, "money.view")) return null;
  const copy = dictionary.invoicing;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const limits = TOP_UP_LIMITS[circle.circle.currency];
  const askable = circle.members
    .filter((member) => member.status === "active" && (member.role === "organizer" || member.role === "contributor") && member.id !== circle.viewer.memberId)
    .map((member) => ({ id: member.id, name: names.member(member.id) }));
  const canAsk = may(circle, "invoice.request") && topUpServices() !== null && limits !== undefined && askable.length > 0;
  return (
    <Panel title={copy.title} description={copy.lede} flush>
      {circle.invoiceRequests.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-muted-foreground sm:px-6">{copy.empty}</p>
      ) : (
        <ul className="divide-y border-t">
          {circle.invoiceRequests.map((request) => {
            const name = names.member(request.memberId);
            const purpose = request.purpose === "settlement" && request.period !== null ? fill(copy.purposes.settlement, { month: format.month(request.period) }) : copy.purposes.topUp;
            return (
              <li key={request.id} className="grid min-w-0 gap-3 px-5 py-4 transition-colors duration-300 hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6 sm:px-6">
                <div className="min-w-0">
                  <p className="font-medium text-pretty">{name}</p>
                  <p className="text-sm text-muted-foreground">{purpose}</p>
                </div>
                <p className="font-serif text-2xl leading-none whitespace-nowrap tabular-nums sm:text-end">{format.money(request.cents)}</p>
                <div className="min-w-0 sm:col-span-2">
                  <InvoiceStatus request={request} name={name} viewer={invoiceViewer(circle, request)} copy={copy} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canAsk && limits !== undefined ? (
        <div className="border-t px-5 py-5 sm:px-6">
          <InvoiceTopUpForm members={askable} hint={fill(copy.topUp.hint, { min: format.money(limits.minCents), max: format.money(limits.maxCents) })} copy={copy} />
        </div>
      ) : null}
    </Panel>
  );
}
