import type { InvoiceRequestRecord } from "@kin/db";

import type { Dictionary } from "@/i18n/dictionary";

import { InvoiceRequestButton } from "./invoice-request-button";
import { InvoiceStatus } from "./invoice-status";

type Props = {
  memberId: string;
  name: string;
  /** The newest settlement request for this member and period, if any. */
  request: InvoiceRequestRecord | null;
  viewer: "organizer" | "payer" | "family";
  copy: Dictionary["invoicing"];
};

/**
 * The PayPal invoice behind one of the settlement's collections: where it
 * stands once requested, or, for an organizer, the button that requests it.
 * A withdrawn or refused request can be asked for again.
 */
export function CollectionInvoice({ memberId, name, request, viewer, copy }: Props) {
  const ended = request === null || request.state === "cancelled" || request.state === "failed";
  return (
    <div className="mt-3 grid min-w-0 gap-3">
      {request === null ? null : <InvoiceStatus request={request} name={name} viewer={viewer} copy={copy} />}
      {ended && viewer === "organizer" ? <InvoiceRequestButton memberId={memberId} copy={copy} /> : null}
    </div>
  );
}
